import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return { prisma: new PrismaClient({ datasourceUrl: "file:" + join(tmpdir(), "ai-test-" + randomUUID() + ".db") }) };
});
import { prisma } from "@/lib/db";
import { defaultSettings } from "./prompts";
import { saveSettings, readSettings, publicSettings, endpointUrls, protectKey, revealKey, resolveModel } from "./config";
import { createContext, readContext, sessionMetrics } from "./context";
import { createRun, executeRun, cancelRun, recoverRuns, retryRun, validatedResult, resumeRun } from "./runs";
import { generate, sseData } from "./provider";
import { createReplaySession } from "@/lib/replay-sessions/service";
import { PATCH as updateEntry } from "@/app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route";
import { POST as aiPOST, GET as aiGET } from "@/app/api/ai/[...path]/route";
import { LIMITS, skillKeys, type RunInput } from "./schema";
import { executeReadTool, emptyFilters, scopeManifest, tradeRef, type ToolScope } from "./tools";
import { generateTurn } from "./provider";
import { executeChartTool, chartRef } from "./chart-tools";
import { coverageLedger } from "./program-evidence";
import { saveAsset } from "./assets";
import { entryLotId, fifoRowId } from "@/lib/paper-trading/journal-identity";
let file = "", sessionId = "", projectionId = "", entryId = "";
const base = new Date("2026-10-01T00:00:00Z");
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: "file:" + file }, stdio: "pipe" });
  vi.stubEnv("AI_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  await prisma.marketDataset.create({ data: { id: "market", name: "test", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 10, startTime: base, endTime: new Date(+base + 540000) } });
  await prisma.marketBar.createMany({ data: Array.from({ length: 10 }, (_, sequence) => ({
    datasetId: "market", sequence, timestamp: new Date(+base + sequence * 60000),
    open: sequence > 4 ? 987654321 : 100 + sequence, high: sequence > 4 ? 987654322 : 102 + sequence,
    low: sequence > 4 ? 987654320 : 99 + sequence, close: sequence > 4 ? 987654321 : 101 + sequence,
  })) });
  const s = await createReplaySession("market", { name: "AI fixture", mode: "TRAINING", timestamp: base.toISOString(), playbackRate: 1, displayIntervalSeconds: 300, displaySession: "ETH" });
  sessionId = s.id; projectionId = s.activeProjectionId!;
  await prisma.replayProjection.update({ where: { id: projectionId }, data: { currentSequence: 3 } });
  const journal = await prisma.replayJournalSession.create({ data: { datasetId: "market", replaySessionId: sessionId, replayGeneration: 1, initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0 } });
  const entry = await prisma.replayJournalEntry.create({ data: {
    id: "entry-one", logicalKey: "stable-one", cycleKey: "cycle-one", projectionId, journalSessionId: journal.id, no: 1, accountNo: 1,
    lotId: "lot-one", direction: "LONG", quantity: 1, openedSequence: 1, openedAt: new Date(+base + 60000),
    closedSequence: 3, closedAt: new Date(+base + 180000), entryPrice: 101, exitPrice: 104,
    initialStopPrice: 99, abrLength: 8, displayIntervalSeconds: 300, displaySession: "ETH", displayUtcOffsetMinutes: 0,
    priceTickSize: 1, initialRisk: 2, actualRisk: 1, gainLoss: 3, review: "原始复盘",
  } }); entryId = entry.id;
  const account = await prisma.paperTradingSession.create({ data: { id: "account", datasetId: "market", projectionId, journalSessionId: journal.id, initialCapital: 10000, currency: "USD", lastProcessedSequence: 3, peakEquity: 10000 } });
  await prisma.paperOrder.create({ data: { id: "order-one", sessionId: account.id, side: "BUY", type: "MARKET", quantity: 1, createdSequence: 0, activeFromSequence: 1 } });
  await prisma.paperFill.createMany({ data: [1, 3, 7].map((sequence) => ({
    id: "fill-" + sequence, sessionId: account.id, orderId: "order-one", cycleKey: "cycle-one", sequence,
    timestamp: new Date(+base + sequence * 60000), side: sequence === 1 ? "BUY" : "SELL", price: sequence === 7 ? 987654321 : 101 + sequence,
    quantity: 1, fee: 0.1, slippageCost: 0, realizedPnl: sequence === 3 ? 3 : 0,
    closedQuantity: sequence === 1 ? 0 : 1, openedQuantity: sequence === 1 ? 1 : 0, netQuantityAfter: sequence === 1 ? 1 : 0, reason: "USER",
  })) });
  for (const sequence of [0, 7]) {
    const command = await prisma.replayCommand.create({ data: { replaySessionId: sessionId, sourceSequence: sequence, ordinal: 1, type: "ORDER_CREATE",
      payload: JSON.stringify({ order: { id: "order-one", price: sequence === 7 ? 987654321 : 101 } }) } });
    await prisma.replayProjectionCommand.create({ data: { commandId: command.id, projectionId } });
  }
}, 30000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await prisma.$disconnect(); vi.unstubAllEnvs(); if (file.includes("ai-test-")) rmSync(file, { force: true }); });
function streamResponse(text: string, finish = "stop", done = true, reasoning?: string) {
  const raw = (reasoning ? "data: " + JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning }, finish_reason: null }] }) + "\n\n" : "")
    + 'data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] }) + "\n\n"
    + "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + "\n\n" + (done ? "data: [DONE]\n\n" : "");
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(raw)); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}
async function configure() {
  const old = await readSettings(), settings = defaultSettings();
  settings.endpoints = [{ id: "local", name: "Mock", protocol: "chat-completions", baseUrl: "http://localhost:9999/v1", chatUrl: "", modelsUrl: "", defaultModel: "test", models: ["test"], capabilities: {}, apiKey: "private-test-key" }];
  settings.activeEndpointId = "local";
  return saveSettings(settings, old.version);
}
async function makeRun(contextId?: string, task: RunInput["task"] = "globalAssistant", executionMode: RunInput["executionMode"] = "fixed-v1") {
  const chat = await prisma.aiConversation.create({ data: { name: "test" } });
  return createRun({ conversationId: chat.id, contextId, task, executionMode, question: "整理复盘", assetIds: [], chartImages: false, requestId: randomUUID() });
}
function toolResponse(calls: Array<{ id: string; name: string; args: unknown }>, reasoning = "真实返回的思考") {
  const chunks = [{ choices: [{ delta: { reasoning_content: reasoning } }] },
    ...calls.map((c, index) => ({ choices: [{ delta: { tool_calls: [{ index, id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] })),
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] }];
  return new Response(chunks.map((c) => "data: " + JSON.stringify(c) + "\r\n\r\n").join("") + "data: [DONE]\r\n\r\n");
}
describe("A: scoped read tools and persisted protocol", () => {
  it("completes a multi-call DeepSeek-shaped loop with matching IDs, reasoning and actual-read sources", async () => {
    await configure();
    const settings = await readSettings(); settings.value.endpoints[0].adapterProfile = "deepseek"; await saveSettings(settings.value, settings.version);
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", draft: "" });
    const run = await makeRun(ctx.id, "reviewDraft", "tools-v1");
    const mock = vi.fn().mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body);
      if (mock.mock.calls.length === 1) {
        const manifest = JSON.parse(request.messages.at(-1).content).scopeManifest;
        expect(JSON.stringify(request.messages)).not.toContain(ctx.entries[0].review);
        return toolResponse([{ id: "facts-call", name: "get_trade_record", args: { tradeRef: manifest.selection.selectedTradeRef, sections: ["facts"], cursor: null, limit: null } }, { id: "template-call", name: "get_review_template", args: {} }]);
      }
      expect(request.messages.find((m: { role: string }) => m.role === "assistant").reasoning_content).toBe("真实返回的思考");
      const results = request.messages.filter((m: { role: string }) => m.role === "tool");
      expect(results.map((r: { tool_call_id: string }) => r.tool_call_id)).toEqual(["facts-call", "template-call"]);
      expect(JSON.parse(results[1].content).data.draft.text).toBe("");
      return streamResponse(JSON.stringify({ draft: "事实复盘，动机未记录。", analysis: "资料限制。", sources: [JSON.parse(results[0].content).sources[0].sourceRef], missing: ["原计划未记录"] }));
    });
    vi.stubGlobal("fetch", mock); await executeRun(run.id);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    expect(await prisma.aiRunStep.count({ where: { runId: run.id, status: "COMPLETED" } })).toBe(2);
    expect(await prisma.aiToolCall.count({ where: { runId: run.id, status: "COMPLETED" } })).toBe(2);
    expect(await prisma.aiMessage.count({ where: { runId: run.id, role: "assistant" } })).toBe(1);
  });
  it("rejects unearned adoption, unregistered tools, foreign references and mismatched cursors", async () => {
    await configure(); const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const scope: ToolScope = { id: "one", secret: "secret-one", context: ctx }, signal = new AbortController().signal;
    expect(executeReadTool(scope, "list_trade_records", { filters: emptyFilters, cursor: null, limit: 1 }, signal).error?.code).toBe("OUT_OF_SCOPE");
    expect(executeReadTool(scope, "get_trade_record", { tradeRef: "trade:other", sections: ["facts"], cursor: null, limit: null }, signal).error?.code).toBe("NOT_FOUND_IN_SCOPE");
    expect(JSON.stringify(scopeManifest(scope))).not.toContain(ctx.entries[0].review);
    const sessionScope: ToolScope = { ...scope, context: { ...ctx, selectedEntryId: undefined, entries: Array.from({ length: 55 }, (_, i) => ({ ...ctx.entries[0], logicalKey: "key" + i, no: i + 1, globalNo: i + 1 })) } };
    const page = executeReadTool(sessionScope, "list_trade_records", { filters: emptyFilters, cursor: null, limit: 50 }, signal);
    expect(Number(page.coverage.returnedRows)).toBeGreaterThan(0);
    expect(Number(page.coverage.returnedRows)).toBeLessThanOrEqual(50);
    expect(executeReadTool(sessionScope, "list_trade_records", { filters: { ...emptyFilters, direction: "SHORT" }, cursor: page.nextCursor, limit: 50 }, signal).error?.code).toBe("INVALID_CURSOR");
    let next = page;
    while (next.nextCursor) next = executeReadTool(sessionScope, "list_trade_records", { filters: emptyFilters, cursor: next.nextCursor, limit: 50 }, signal);
    expect(next.coverage.returnedSoFar).toBe(55);
    const facts = executeReadTool(scope, "get_trade_record", { tradeRef: tradeRef(scope, ctx.entries[0]), sections: ["facts"], cursor: null, limit: null }, signal);
    expect(facts.ok && facts.data.review).toBeUndefined();
    const run = await makeRun(ctx.id, "reviewDraft", "tools-v1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify({ draft: "不应采用", analysis: "", sources: [], missing: [] }))));
    await executeRun(run.id); expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("INVALID_RESULT");
  });
  it("rejects partial/duplicate protocol calls before execution and permits nonstream policy chosen in advance", async () => {
    const endpoint = (await configure()).value.endpoints[0];
    const tools = [{ type: "function" as const, function: { name: "get_review_template", description: "template", parameters: {} } }];
    const signal = new AbortController().signal;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(toolResponse([{ id: "same", name: "get_review_template", args: {} }, { id: "same", name: "get_review_template", args: {} }])));
    await expect(generateTurn(endpoint, "test", [], signal, undefined, undefined, {}, { tools })).rejects.toMatchObject({ code: "PROTOCOL" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, reasoning_content: "保留", tool_calls: [{ id: "one", type: "function", function: { name: "get_review_template", arguments: "{}" } }] } }] })));
    const turn = await generateTurn({ ...endpoint, toolTransport: "nonstream" }, "test", [], signal, undefined, undefined, {}, { tools });
    expect(turn.assistant.reasoning_content).toBe("保留"); expect(turn.finish).toBe("tool_calls");
    await expect(createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", draft: "😀".repeat(2001) })).rejects.toMatchObject({ code: "DRAFT_TOO_LONG" });
    expect((await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", draft: "😀".repeat(2000) })).originalDraft).toHaveLength(4000);
  });
});
describe("B: frozen multi-period charts", () => {
  it.each(["generic", "deepseek"] as const)("delivers distinct prepared images with complete tool-result matching (%s)", async (adapterProfile) => {
    await configure(); const settings = await readSettings(); settings.value.endpoints[0].adapterProfile = adapterProfile; await saveSettings(settings.value, settings.version);
    const c = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", draft: "", timeframes: ["5m", "1h"] });
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=";
    for (const ch of c.charts) await saveAsset(png, c.id, ch.hash);
    const chat = await prisma.aiConversation.create({ data: { name: "images" } });
    const run = await createRun({ conversationId: chat.id, contextId: c.id, task: "globalAssistant", question: "看两个周期", chartImages: true, assetIds: [], requestId: randomUUID() });
    const mock = vi.fn().mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body);
      if (mock.mock.calls.length === 1) {
        const manifest = JSON.parse(request.messages.at(-1).content).scopeManifest;
        return toolResponse([{ id: "images", name: "get_chart_context", args: { chartRef: manifest.selection.chartRef, timeframes: ["5m", "1h"], includeImage: true, cursor: null, limit: 120 } }]);
      }
      const results = request.messages.filter((m: { role: string }) => m.role === "tool");
      expect(results).toHaveLength(1); expect(results[0].tool_call_id).toBe("images");
      const imageMessages = request.messages.filter((m: { content: unknown }) => Array.isArray(m.content) && m.content.some((p: { type: string }) => p.type === "image_url"));
      expect(imageMessages.every((m: { role: string }) => m.role === (adapterProfile === "deepseek" ? "tool" : "user"))).toBe(true);
      expect(imageMessages.flatMap((m: { content: Array<{ type: string }> }) => m.content.filter((p) => p.type === "image_url"))).toHaveLength(2);
      return streamResponse("已读取两个各自冻结的周期图，形成柱截至同一序号。");
    });
    vi.stubGlobal("fetch", mock); await executeRun(run.id);
    const call = await prisma.aiToolCall.findFirstOrThrow({ where: { runId: run.id } });
    expect(JSON.parse(call.receipts).filter((r: { evidenceKind: string }) => r.evidenceKind === "CHART_IMAGE")).toHaveLength(2);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
  });
  it("normalizes 60m/1h, preserves the shared cutoff and reports unprepared images truthfully", async () => {
    const c = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", timeframes: ["5m", "1h"] });
    const scope: ToolScope = { id: "chart-run", secret: "chart-secret", context: c }, signal = new AbortController().signal;
    const raw = { chartRef: chartRef(scope, c.entries[0]), timeframes: ["5m", "60m", "1h"], cursor: null, limit: 120, includeImage: true };
    const response = await executeChartTool(scope, c.id, raw, signal, []);
    expect(response.result.ok).toBe(true);
    const charts = response.result.ok ? response.result.data.charts as Array<{ timeframe: string; cutoffSequence: number; bars: Array<{ lastSequence: number; status: string }>; imageStatus: string; windowHash: string }> : [];
    expect(charts.map((ch) => ch.timeframe)).toEqual(["5m", "1h"]);
    expect(charts.every((ch) => ch.cutoffSequence === 3 && ch.bars.every((b) => b.lastSequence <= 3 && b.status === "FORMING"))).toBe(true);
    expect(new Set(charts.map((ch) => ch.windowHash)).size).toBe(2);
    expect(charts.every((ch) => ch.imageStatus === "IMAGE_NOT_PREPARED")).toBe(true);
    expect(response.result.sources.every((s) => !s.imageAttached)).toBe(true);
    expect(JSON.stringify(response)).not.toContain("98765432");
    for (const timeframes of [[], ["1s"], ["1m", "5m", "15m", "1h", "4h"]]) expect((await executeChartTool(scope, c.id, { ...raw, timeframes }, signal, [])).result.ok).toBe(false);
    const before = await prisma.aiChartVariant.count({ where: { contextId: c.id } });
    await executeChartTool(scope, c.id, raw, signal, []);
    expect(await prisma.aiChartVariant.count({ where: { contextId: c.id } })).toBe(before);
    await prisma.marketDataset.update({ where: { id: c.datasetId }, data: { dataVersion: { increment: 1 } } });
    try {
      expect((await executeChartTool(scope, c.id, { ...raw, timeframes: ["15m"] }, signal, [])).result.error?.code).toBe("STALE_CONTEXT");
      expect((await executeChartTool(scope, c.id, raw, signal, [])).result.ok).toBe(true);
    } finally { await prisma.marketDataset.update({ where: { id: c.datasetId }, data: { dataVersion: c.dataVersion } }); }
  });
});
describe("C: complete-session program scheduling with final tool verification", () => {
  it("finishes a full chart analysis in the standalone worker using uploaded assets and a local HTTP model", async () => {
    await configure();
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const part of request) chunks.push(Buffer.from(part));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const result = !body.tools ? streamResponse("已读取全部本批事实及预先上传的图片") : !body.messages.some((m: { role: string }) => m.role === "tool")
        ? toolResponse([{ id: "worker-statistics", name: "get_session_statistics", args: { view: "overall", cursor: null, limit: null } }])
        : streamResponse(JSON.stringify({ summary: "完整会话已覆盖；候选结论仍需下个会话验证。", rules: [], missing: [] }));
      response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end(await result.text());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No local model port");
    const settings = await readSettings(); settings.value.endpoints[0].baseUrl = "http://127.0.0.1:" + address.port + "/v1"; await saveSettings(settings.value, settings.version);
    const context = await createContext({ replaySessionId: sessionId, projectionId, depth: "full" });
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=";
    for (const chart of context.charts) await saveAsset(png, context.id, chart.hash);
    const before = (await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } })).review;
    const run = await makeRun(context.id, "sessionReview", "tools-v1");
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/ai-analysis-worker.ts", run.id], { env: { ...process.env, DATABASE_URL: "file:" + file, MARKET_DATA_SYNC_ENABLED: "0" }, windowsHide: true, stdio: "ignore" });
    const timeout = setTimeout(() => child.kill(), 20000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
      expect(code).toBe(0);
      const saved = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(saved.status).toBe("COMPLETED");
      expect(coverageLedger(context, JSON.parse(saved.checkpoint).flatMap((p: { coverage?: unknown }) => p.coverage ? [p.coverage] : []))).toMatchObject({ complete: true, readImages: context.charts.length, missingImages: 0 });
      expect((await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } })).review).toBe(before);
    } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); await new Promise<void>((resolve) => server.close(() => resolve())); await configure(); }
  }, 30000);
  it("compares fixed-data and tool mode for the same question and frozen scope using a local protocol fixture", async () => {
    await configure(); const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", draft: "" });
    const results: Array<{ mode: string; status: string; calls: number; estimatedChars: number; durationMs: number; usage: unknown }> = [];
    for (const mode of ["fixed-v1", "tools-v1"] as const) {
      const run = await makeRun(context.id, "reviewDraft", mode), started = Date.now();
      const mock = vi.fn().mockImplementation(async (_url, options) => {
        const request = JSON.parse(options.body);
        if (request.tools && !request.messages.some((m: { role: string }) => m.role === "tool")) {
          const manifest = JSON.parse(request.messages.at(-1).content).scopeManifest;
          return toolResponse([{ id: "compare-facts", name: "get_trade_record", args: { tradeRef: manifest.selection.selectedTradeRef, sections: ["facts"], cursor: null, limit: null } }, { id: "compare-template", name: "get_review_template", args: {} }]);
        }
        const factResult = request.messages.find((m: { role: string; tool_call_id?: string }) => m.role === "tool" && m.tool_call_id === "compare-facts");
        return streamResponse(JSON.stringify({ draft: "交易事实已核对；原计划与情绪未记录。", analysis: "仅使用本次资料。", sources: [factResult ? JSON.parse(factResult.content).sources[0].sourceRef : context.entries[0].sourceId], missing: ["原计划与情绪未记录"] }));
      });
      vi.stubGlobal("fetch", mock); await executeRun(run.id);
      const saved = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
      results.push({ mode, status: saved.status, calls: saved.calls, estimatedChars: JSON.parse(saved.snapshot).estimatedChars, durationMs: Date.now() - started, usage: JSON.parse(saved.usage) });
    }
    expect(results.map((r) => r.status)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(results.map((r) => r.calls)).toEqual([1, 2]);
    expect(results.every((r) => r.estimatedChars > 0 && r.durationMs >= 0)).toBe(true);
    console.info("AI_LOCAL_MODE_COMPARISON", JSON.stringify(results));
  });
  it("resumes completed tool protocol units without repeating paid extraction or tool results", async () => {
    await configure(); const c = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const run = await makeRun(c.id, "sessionReview", "tools-v1");
    const first = vi.fn().mockResolvedValueOnce(streamResponse("完整批次"))
      .mockResolvedValueOnce(toolResponse([{ id: "resume-statistics", name: "get_session_statistics", args: { view: "overall", cursor: null, limit: null } }]))
      .mockRejectedValueOnce(new Error("unknown paid request outcome"));
    vi.stubGlobal("fetch", first); await executeRun(run.id);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED");
    await resumeRun(run.id);
    const resumed = vi.fn().mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body); expect(request.messages.filter((m: { role: string }) => m.role === "tool")).toHaveLength(1);
      return streamResponse(JSON.stringify({ summary: "显式继续后的完整报告", rules: [], missing: ["未审图"] }));
    });
    vi.stubGlobal("fetch", resumed); await executeRun(run.id);
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(await prisma.aiToolCall.count({ where: { runId: run.id } })).toBe(1);
    const saved = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } }); expect(saved.status).toBe("COMPLETED"); expect(saved.calls).toBe(4);
    expect(JSON.parse(saved.usage)[2]).toEqual({ input: null, output: null });
  });
  it("reserves the sixth model request for closing and never silently retries a paid error", async () => {
    await configure(); const c = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const run = await makeRun(c.id, "globalAssistant", "tools-v1");
    const mock = vi.fn().mockImplementation(async (_url, options) => JSON.parse(options.body).tool_choice === "none" ? streamResponse("读取达到上限，仅就已读部分回答。") : toolResponse([{ id: "loop-" + mock.mock.calls.length, name: "get_review_template", args: {} }]));
    vi.stubGlobal("fetch", mock); await executeRun(run.id);
    expect(mock).toHaveBeenCalledTimes(6); expect(await prisma.aiToolCall.count({ where: { runId: run.id } })).toBe(5);
    const failed = await makeRun(c.id, "globalAssistant", "tools-v1"), network = vi.fn().mockRejectedValue(new Error("connection unknown"));
    vi.stubGlobal("fetch", network); await executeRun(failed.id);
    expect(network).toHaveBeenCalledTimes(1); expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("FAILED");
  });
  it("covers every frozen row including empty reviews, then shares the tool loop budget and evidence chain", async () => {
    await configure(); const original = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const context = { ...original, template: { id: "selected-session-template", name: "本次选用", content: "原计划\n执行\n改进" }, entries: Array.from({ length: 9 }, (_, i) => ({ ...original.entries[0], id: "session-row:" + i, logicalKey: "session-key:" + i, no: i + 1, globalNo: i + 1, review: i === 0 ? "已写笔记" : "" })) };
    const fixed = await prisma.aiContext.create({ data: { value: JSON.stringify(context) } });
    const run = await makeRun(fixed.id, "sessionReview", "tools-v1");
    let source = "";
    const mock = vi.fn().mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body), last = request.messages.at(-1);
      if (!request.tools) {
        const batch = JSON.parse(last.content[0].text.split("REFERENCE_DATA:\n")[1]);
        source ||= batch.records[0].sources[0];
        expect(batch.records.every((r: { review?: unknown; facts?: unknown }) => r.review && r.facts)).toBe(true);
        expect(batch.template.data.template.content).toBe("原计划\n执行\n改进");
        return streamResponse("候选观察，来源 " + source);
      }
      if (!request.messages.some((m: { role: string }) => m.role === "tool")) {
        const program = JSON.parse(request.messages.find((m: { content: unknown }) => typeof m.content === "string" && m.content.includes('"programInput"')).content).programInput;
        expect(program.coverage).toMatchObject({ expectedRows: 9, factRows: 9, reviewedRows: 1, emptyReviewRows: 8, complete: true });
        expect(program.overall.ok).toBe(true);
        return toolResponse([{ id: "groups", name: "get_session_statistics", args: { view: "setup_direction", cursor: null, limit: null } }]);
      }
      return streamResponse(JSON.stringify({ summary: "覆盖全部 9 行；快速模式未审图。Setup 扣费净额暂不可用。", rules: [{ rule: "候选观察，尚需验证", supports: [source], counterexamples: [], validation: "下一会话记录支持与反例" }], missing: ["缺少独立反例"] }));
    });
    vi.stubGlobal("fetch", mock); await executeRun(run.id);
    const complete = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(complete.status).toBe("COMPLETED"); expect(complete.calls).toBe(4);
    expect(await prisma.aiRunStep.count({ where: { runId: run.id } })).toBe(4);
    expect(JSON.parse(complete.checkpoint).flatMap((b: { coverage: { entryKeys: string[] } }) => b.coverage.entryKeys)).toHaveLength(9);
    expect(coverageLedger(context, [])).toMatchObject({ complete: false, factRows: 0 });
  });
});
describe("AI configuration and transport boundaries", () => {
  it("encrypts, rejects tampering and normalizes explicit version paths", () => {
    const cipher = protectKey("secret"); expect(cipher).not.toContain("secret"); expect(revealKey(cipher)).toBe("secret");
    expect(() => revealKey(cipher + "x")).toThrow();
    expect(endpointUrls({ baseUrl: "https://example.test/v1///", chatUrl: "", modelsUrl: "" }).chat).toBe("https://example.test/v1/chat/completions");
    expect(() => endpointUrls({ baseUrl: "file:///tmp", chatUrl: "", modelsUrl: "" })).toThrow();
    expect(() => endpointUrls({ baseUrl: "https://user:pass@example.test", chatUrl: "", modelsUrl: "" })).toThrow();
  });
  it("preserves and explicitly clears keys; rejects stale configuration and forged capability state", async () => {
    const saved = await configure();
    expect(JSON.stringify(saved)).not.toContain("private-test-key");
    const old = await readSettings(); const key = old.value.endpoints[0].encryptedKey;
    old.value.endpoints[0].apiKey = ""; old.value.endpoints[0].capabilities.test = { vision: "SUPPORTED" };
    await saveSettings(old.value, old.version);
    const next = await readSettings();
    expect(next.value.endpoints[0].encryptedKey).toBe(key);
    expect(next.value.endpoints[0].capabilities.test?.vision).not.toBe("SUPPORTED");
    expect(publicSettings(next.value).endpoints[0].hasApiKey).toBe(true);
    await expect(saveSettings(next.value, old.version)).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    next.value.endpoints[0].clearApiKey = true; await saveSettings(next.value, next.version);
    expect((await readSettings()).value.endpoints[0].encryptedKey).toBeUndefined();
  });
  it("fetches models before a default is selected and prevents unconfigured model calls", async () => {
    await configure();
    const saved = await readSettings();
    saved.value.endpoints[0].defaultModel = "";
    saved.value.endpoints[0].models = [];
    await saveSettings(saved.value, saved.version);
    const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "model-a" }, { id: "model-b" }, { id: "model-a" }] }));
    vi.stubGlobal("fetch", mock);
    const response = await aiPOST(new Request("http://localhost/api/ai/endpoint-action", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ id: "local", action: "models" }) }), { params: Promise.resolve({ path: ["endpoint-action"] }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["model-a", "model-b"] });
    expect(mock).toHaveBeenCalledWith("http://localhost:9999/v1/models", expect.any(Object));
    await expect(makeRun()).rejects.toMatchObject({ code: "MODEL_REQUIRED" });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("uses the global endpoint and model for every skill and ignores legacy overrides on read and save", async () => {
    await configure();
    const old = await readSettings();
    const legacy = { ...old.value, skills: { ...old.value.skills }, endpoints: [...old.value.endpoints, { ...old.value.endpoints[0], id: "other", name: "Other", defaultModel: "other-model" }] };
    for (const key of skillKeys) Object.assign(legacy.skills[key], { endpointId: "removed-endpoint", model: "hidden-model" });
    await prisma.aiSetting.update({ where: { id: "config" }, data: { value: JSON.stringify(legacy) } });
    const read = await readSettings();
    for (const key of skillKeys) {
      expect(read.value.skills[key]).toEqual({ enabled: true, prompt: old.value.skills[key].prompt });
      expect(resolveModel(read.value, key)).toMatchObject({ endpoint: { id: "local" }, model: "test", prompt: old.value.skills[key].prompt });
    }
    const saved = await saveSettings({ ...legacy, activeEndpointId: "other" }, read.version);
    const stored = JSON.parse((await prisma.aiSetting.findUniqueOrThrow({ where: { id: "config" } })).value);
    for (const key of skillKeys) {
      expect(resolveModel(saved.value, key)).toMatchObject({ endpoint: { id: "other" }, model: "other-model" });
      expect(stored.skills[key]).toEqual({ enabled: true, prompt: old.value.skills[key].prompt });
    }
    const run = await makeRun();
    expect(JSON.parse(run.snapshot)).toMatchObject({ endpoint: { id: "other" }, model: "other-model" });
    await cancelRun(run.id);
    saved.value.skills.chartReading.enabled = false;
    expect(() => resolveModel(saved.value, "chartReading")).toThrow();
  });
  it("tests connection with one text request without probing or changing capabilities", async () => {
    const saved = await configure();
    const mock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { role: "assistant", content: null, reasoning_content: "thinking" }, finish_reason: "length" }] }));
    vi.stubGlobal("fetch", mock);
    const response = await aiPOST(new Request("http://localhost/api/ai/endpoint-action", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ id: "local", action: "test", model: "test" }) }), { params: Promise.resolve({ path: ["endpoint-action"] }) });
    expect(await response.json()).toEqual({ status: "CONNECTED" });
    expect(mock).toHaveBeenCalledTimes(1);
    const request = mock.mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual({ model: "test", stream: false, max_tokens: 100, messages: [{ role: "user", content: "Reply OK." }] });
    expect(request.headers.Authorization).toBe("Bearer private-test-key");
    const after = await readSettings();
    expect(after.version).toBe(saved.version);
    expect(after.value.endpoints[0].capabilities).toEqual({});
  });
  it("reports connection failures safely and requires a selected model before testing", async () => {
    await configure();
    const request = (model: string) => aiPOST(new Request("http://localhost/api/ai/endpoint-action", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ id: "local", action: "test", model }) }), { params: Promise.resolve({ path: ["endpoint-action"] }) });
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    expect((await request("")).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
    mock.mockResolvedValueOnce(Response.json({ error: { message: "private-test-key" } }, { status: 401 }));
    const unauthorized = await request("test");
    expect(await unauthorized.json()).toEqual({ status: "FAILED", message: expect.any(String) });
    mock.mockResolvedValueOnce(Response.json({}));
    const malformed = await request("test");
    expect(await malformed.json()).toEqual({ status: "FAILED", message: expect.any(String) });
    mock.mockRejectedValueOnce(new Error("private-test-key"));
    const failed = await request("test");
    expect(await failed.text()).not.toContain("private-test-key");
  });
  it("decodes split UTF-8, multiline SSE and rejects truncated or unfinished responses", async () => {
    const encoded = new TextEncoder().encode("data: 中文\r\n\r\n");
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of encoded) c.enqueue(Uint8Array.of(byte)); c.close(); } });
    const result: string[] = []; for await (const s of sseData(body, new AbortController().signal)) result.push(s);
    expect(result).toEqual(["中文"]);
    await configure(); const endpoint = (await readSettings()).value.endpoints[0];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("partial", "length")));
    await expect(generate(endpoint, "test", [], new AbortController().signal)).rejects.toMatchObject({ code: "INCOMPLETE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("partial", "stop", false)));
    await expect(generate(endpoint, "test", [], new AbortController().signal)).rejects.toMatchObject({ code: "INCOMPLETE" });
  });
  it("blocks cross-origin mutations before any model call and does not leak ciphertext in settings", async () => {
    const response = await aiPOST(new Request("http://localhost/api/ai/conversations", { method: "POST", headers: { Origin: "http://evil.test" } }), { params: Promise.resolve({ path: ["conversations"] }) });
    expect(response.status).toBe(403);
    const settings = await aiGET(new Request("http://localhost/api/ai/settings"), { params: Promise.resolve({ path: ["settings"] }) });
    expect(await settings.text()).not.toContain("encryptedKey");
  });
  it("separates exposed reasoning from the answer and measures time to answer and completion", async () => {
    await configure(); const endpoint = (await readSettings()).value.endpoints[0];
    const started = Date.parse("2026-10-15T12:00:00Z"), clock = vi.spyOn(Date, "now").mockReturnValue(started);
    const onDetails = vi.fn(), onDelta = vi.fn(() => clock.mockReturnValue(started + 2100));
    const onReasoning = vi.fn(() => clock.mockReturnValue(started + 1600));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("最终回答", "stop", true, "核对所提供的事实。")));
    try {
      const result = await generate(endpoint, "test", [], new AbortController().signal, onDelta, undefined, { onReasoning, onDetails });
      expect(result.content).toBe("最终回答");
      expect(onReasoning).toHaveBeenCalledWith("核对所提供的事实。");
      expect(onDelta).toHaveBeenCalledWith("最终回答");
      expect(onDetails).toHaveBeenCalledWith({ startedAt: new Date(started).toISOString(), durationMs: 2100, reasoning: "核对所提供的事实。", reasoningMs: 1600 });
    } finally { clock.mockRestore(); }
  });
  it("bounds reasoning output and retains partial metadata without accepting reasoning-only or truncated answers", async () => {
    const endpoint = (await readSettings()).value.endpoints[0], onDetails = vi.fn(), onReasoning = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("", "stop", true, "只有思考，没有回答")));
    await expect(generate(endpoint, "test", [], new AbortController().signal, undefined, undefined, { onDetails })).rejects.toMatchObject({ code: "INCOMPLETE" });
    expect(onDetails).toHaveBeenLastCalledWith(expect.objectContaining({ reasoning: "只有思考，没有回答", reasoningMs: expect.any(Number) }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("", "stop", true, "字".repeat(LIMITS.outputChars + 1))));
    await expect(generate(endpoint, "test", [], new AbortController().signal, undefined, undefined, { onReasoning })).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
    expect(onReasoning).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("字".repeat(32001), "stop", true, "字".repeat(32000))));
    await expect(generate(endpoint, "test", [], new AbortController().signal)).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });
});
describe("frozen review context and safe adoption", () => {
  it("associates closed-lot fills by engine identity and paginates execution without widening a single-row scope", async () => {
    const original = await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } });
    const lotId = entryLotId("fill-1"), key = fifoRowId("fill-3", lotId, 0), rowId = "identity-fixture-" + randomUUID();
    await prisma.replayJournalEntry.create({ data: { ...original, id: rowId, logicalKey: key, lotId, no: 99, accountNo: 99, entryPrice: 102, review: "" } });
    try {
      const context = await createContext({ replaySessionId: sessionId, projectionId, entryId: rowId, depth: "quick" });
      context.events.push({ sourceId: "unrelated-cycle-event", cycleKey: context.entries[0].cycleKey ?? null, sequence: 2, kind: "ORDER_UPDATE", value: { sentinel: "UNLINKED_CYCLE_SENTINEL" } });
      const scope: ToolScope = { id: "identity-scope", secret: "identity-scope-secret", context }, signal = new AbortController().signal;
      const args = { tradeRef: tradeRef(scope, context.entries[0]), sections: ["facts", "execution"], cursor: null as string | null, limit: 1 };
      const ids = new Set<string>(); let result;
      do {
        result = executeReadTool(scope, "get_trade_record", args, signal); expect(result.ok).toBe(true);
        if (result.ok) {
          const events = (result.data.execution as { events: Array<{ sourceId: string; attribution: string }> }).events;
          for (const event of events) { expect(event.attribution).toBe("EXACT_ROW"); expect(ids.has(event.sourceId)).toBe(false); ids.add(event.sourceId); }
          if (args.cursor) { expect(result.data.facts).toBeUndefined(); expect(result.data.previouslyReadAtomicSources).toBeDefined(); }
        }
        expect(JSON.stringify(result)).not.toContain("UNLINKED_CYCLE_SENTINEL");
        args.cursor = result.nextCursor;
      } while (args.cursor);
      expect(ids.size).toBe(3);
      expect(executeReadTool(scope, "get_trade_record", { ...args, sections: ["facts"], cursor: null, limit: null }, signal).coverage.complete).toBe(true);
      await prisma.aiContext.update({ where: { id: context.id }, data: { value: JSON.stringify(context) } });
      const run = await makeRun(context.id, "globalAssistant", "fixed-v1");
      const mock = vi.fn().mockResolvedValue(streamResponse("仅使用可靠关联的执行记录。")); vi.stubGlobal("fetch", mock); await executeRun(run.id);
      expect(mock.mock.calls[0][1].body).not.toContain("UNLINKED_CYCLE_SENTINEL");
    } finally { await prisma.replayJournalEntry.delete({ where: { id: rowId } }); }
  });
  it("never includes future sentinel values, including a forming higher-period candle", async () => {
    const fixed = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", draft: "正在编辑" });
    expect(JSON.stringify(fixed)).not.toContain("98765432");
    expect(fixed.charts[0].window.bars.at(-1)?.lastSequence).toBe(3);
    expect(fixed.charts[0].window.bars.at(-1)?.high).toBe(105);
    expect(fixed.charts[0].window.bars.at(-1)?.status).toBe("FORMING");
    expect(fixed.originalDraft).toBe("正在编辑");
    expect(fixed.entries).toHaveLength(1);
    expect(fixed.events.filter((e) => e.kind === "FILL")).toHaveLength(2);
    expect(fixed.events.some((e) => e.kind === "ORDER_CREATE")).toBe(true);
  });
  it("rejects other sessions/projections and keeps the selected template immutable", async () => {
    await expect(createContext({ replaySessionId: sessionId, projectionId: "other", entryId, depth: "quick" })).rejects.toMatchObject({ code: "CONTEXT_CONFLICT" });
    const template = await prisma.replayReviewTemplate.create({ data: { name: "测试", normalizedName: "测试", content: "原计划\n执行\n改进" } });
    const fixed = await createContext({ replaySessionId: sessionId, projectionId, entryId, templateId: template.id, depth: "quick" });
    await prisma.replayReviewTemplate.update({ where: { id: template.id }, data: { content: "修改后的模板" } });
    expect((await readContext(fixed.id)).template?.content).toBe("原计划\n执行\n改进");
  });
  it("checks original text atomically and writes review provenance only on successful changes", async () => {
    const request = (review: string, expectedReview: string) => new Request("http://localhost/api/entry?replaySessionId=" + sessionId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review, expectedReview, expectedProjectionId: projectionId }) });
    const route = { params: Promise.resolve({ id: "market", entryId }) };
    expect((await updateEntry(request("手动更新", "原始复盘"), route)).status).toBe(200);
    expect((await updateEntry(request("过期覆盖", "原始复盘"), route)).status).toBe(409);
    expect((await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } })).review).toBe("手动更新");
    expect(await prisma.aiReviewRevision.count()).toBe(1);
  });
  it("accepts only bounded drafts and real evidence IDs", async () => {
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const valid = { draft: "正文", analysis: "说明", sources: [ctx.entries[0].sourceId], missing: [] };
    expect(validatedResult("reviewDraft", JSON.stringify(valid), ctx)).not.toBeNull();
    expect(validatedResult("reviewDraft", JSON.stringify({ ...valid, sources: ["fake"] }), ctx)).toBeNull();
    expect(validatedResult("reviewDraft", JSON.stringify({ ...valid, draft: "字".repeat(2001) }), ctx)).toBeNull();
  });
});
describe("run lifecycle and session analysis", () => {
  it("persists display metadata separately, reloads it without secrets and never resends it as conversation history", async () => {
    await configure(); const run = await makeRun(), events: unknown[] = [];
    const thought = "display-only-reasoning-哨兵";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("已核对交易事实。", "stop", true, thought)));
    await executeRun(run.id, (event) => events.push(event));
    expect(events).toContainEqual({ type: "reasoning", text: thought });
    const saved = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(JSON.parse(saved.snapshot).response).toMatchObject({ reasoning: thought, durationMs: expect.any(Number), reasoningMs: expect.any(Number) });
    const response = await aiGET(new Request("http://localhost/api/ai/conversations/" + run.conversationId), { params: Promise.resolve({ path: ["conversations", run.conversationId] }) });
    const body = await response.json();
    expect(body.messages.find((m: { role: string }) => m.role === "assistant")).toMatchObject({ content: "已核对交易事实。", result: null, createdAt: expect.any(String), response: { reasoning: thought } });
    expect(body.messages.find((m: { role: string }) => m.role === "user").response).toBeNull();
    expect(JSON.stringify(body)).not.toContain("encryptedKey");
    expect(JSON.stringify(body)).not.toContain("private-test-key");
    const next = await createRun({ conversationId: run.conversationId, task: "globalAssistant", question: "继续", assetIds: [], chartImages: false, requestId: randomUUID() });
    const mock = vi.fn().mockResolvedValue(streamResponse("普通回答")); vi.stubGlobal("fetch", mock);
    await executeRun(next.id);
    const request = mock.mock.calls[0][1].body;
    expect(request).toContain("已核对交易事实。"); expect(request).not.toContain(thought);
    expect(JSON.parse((await prisma.aiRun.findUniqueOrThrow({ where: { id: next.id } })).snapshot).response).toMatchObject({ reasoning: "", reasoningMs: null });
    const retry = await retryRun(run.id);
    expect(JSON.parse(retry.snapshot).response).toBeUndefined(); await cancelRun(retry.id);
  });
  it("keeps truncated reasoning as failed-run metadata without saving a completed assistant answer", async () => {
    const run = await makeRun();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("部分回答", "length", true, "已返回的部分思考")));
    await executeRun(run.id);
    const saved = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("FAILED");
    expect(JSON.parse(saved.snapshot).response.reasoning).toBe("已返回的部分思考");
    expect(await prisma.aiMessage.count({ where: { runId: run.id, role: "assistant" } })).toBe(0);
  });
  it("claims only one run per chat; cancellation prevents late results from being saved", async () => {
    await configure(); const run = await makeRun();
    await expect(createRun({ conversationId: run.conversationId, task: "globalAssistant", question: "并发", assetIds: [], chartImages: false, requestId: randomUUID() })).rejects.toMatchObject({ code: "BUSY" });
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { release!(); await new Promise((r) => setTimeout(r, 50)); return streamResponse("late answer"); }));
    const executing = executeRun(run.id); await started; await cancelRun(run.id); await executing;
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELLED");
    expect(await prisma.aiMessage.count({ where: { runId: run.id, role: "assistant" } })).toBe(0);
  });
  it("uses the original model/configuration on retry and records unknown usage as unknown", async () => {
    const run = await makeRun(); await cancelRun(run.id);
    const settings = await readSettings(); settings.value.endpoints[0].defaultModel = "changed"; await saveSettings(settings.value, settings.version);
    const retry = await retryRun(run.id);
    expect(JSON.parse(retry.snapshot).model).toBe("test");
    await cancelRun(retry.id);
  });
  it("persists completed batches and a validated report, without writing formal reviews", async () => {
    await configure();
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const before = (await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } })).review;
    const run = await makeRun(ctx.id, "sessionReview");
    const answer = { summary: "样本有限，待后续验证。", rules: [{ rule: "候选条件", supports: [ctx.entries[0].sourceId], counterexamples: [], validation: "记录下一会话" }], missing: ["缺少反例，不能确认优势"] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(streamResponse("批次事实与来源", "stop", true, "批次思考"))
      .mockResolvedValueOnce(streamResponse(JSON.stringify(answer), "stop", true, "最终汇总思考")));
    await executeRun(run.id);
    const complete = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(complete.status).toBe("COMPLETED"); expect(JSON.parse(complete.checkpoint)).toHaveLength(1);
    expect(JSON.parse(complete.snapshot).response.reasoning).toBe("最终汇总思考");
    expect(complete.checkpoint).not.toContain("批次思考");
    expect(await prisma.aiAnalysis.count({ where: { runId: run.id } })).toBe(1);
    expect((await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } })).review).toBe(before);
  });
  it("recovers stale runs as interrupted, and only explicitly resumes session analyses", async () => {
    const run = await makeRun();
    await prisma.aiRun.update({ where: { id: run.id }, data: { status: "RUNNING", heartbeatAt: new Date(Date.now() - 300000) } });
    await recoverRuns();
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("INTERRUPTED");
    await expect(resumeRun(run.id)).rejects.toMatchObject({ code: "INVALID" });
  });
  it("uses only the fixed snapshot after navigation and later database changes", async () => {
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const run = await makeRun(ctx.id, "reviewDraft");
    await prisma.replayJournalEntry.update({ where: { id: entryId }, data: { review: "后来修改，不属于原快照" } });
    let requestText = "";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, options) => {
      requestText = String(options.body);
      return streamResponse(JSON.stringify({ draft: "草稿", analysis: "说明", sources: [ctx.entries[0].sourceId], missing: [] }));
    }));
    await executeRun(run.id);
    expect(requestText).not.toContain("后来修改，不属于原快照");
    expect(requestText).not.toContain("987654321");
    const message = await prisma.aiMessage.findFirstOrThrow({ where: { runId: run.id, role: "assistant" } });
    const adopt = await aiPOST(new Request("http://localhost/api/ai/adopt/" + message.id, { method: "POST", headers: { Origin: "http://localhost" } }), { params: Promise.resolve({ path: ["adopt", message.id] }) });
    expect(adopt.status).toBe(409);
  });
  it("allows images without capability tests while rejecting a forged image scope before calling the model", async () => {
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const chat = await prisma.aiConversation.create({ data: { name: "vision" } });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const asset = await prisma.aiAsset.create({ data: { id: randomUUID(), mime: "image/png", bytes: 100, contextId: "other", chartHash: "other" } });
    await expect(createRun({ conversationId: chat.id, contextId: ctx.id, task: "reviewDraft", question: "看图", chartImages: false, assetIds: [asset.id], requestId: randomUUID() })).rejects.toMatchObject({ code: "ASSET_SCOPE" });
    const manual = await prisma.aiAsset.create({ data: { id: randomUUID(), mime: "image/png", bytes: 100 } });
    const run = await createRun({ conversationId: chat.id, task: "chartReading", question: "看图", chartImages: false, assetIds: [manual.id], requestId: randomUUID() });
    expect(JSON.parse(run.snapshot).assetIds).toEqual([manual.id]);
    await cancelRun(run.id);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps failed attempts and reuses completed extraction checkpoints on explicit resume", async () => {
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const run = await makeRun(ctx.id, "sessionReview");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(streamResponse("已完成批次")).mockRejectedValueOnce(new Error("network")));
    await executeRun(run.id);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED");
    await resumeRun(run.id);
    const mock = vi.fn().mockResolvedValue(streamResponse(JSON.stringify({ summary: "重新汇总", rules: [], missing: ["样本不足"] })));
    vi.stubGlobal("fetch", mock); await executeRun(run.id);
    expect(mock).toHaveBeenCalledTimes(1);
    const saved = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.calls).toBe(3);
    expect(JSON.parse(saved.usage)[1]).toEqual({ input: null, output: null });
    expect(saved.status).toBe("COMPLETED");
  });
  it("does not persist a successful report for malformed output and preserves existing data on repeated init", async () => {
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const run = await makeRun(ctx.id, "sessionReview");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(streamResponse("批次")).mockResolvedValueOnce(streamResponse("普通文字，没有结构化结果")));
    await executeRun(run.id);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("INVALID_RESULT");
    expect(await prisma.aiAnalysis.count({ where: { runId: run.id } })).toBe(0);
    const before = await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } });
    const reports = await prisma.aiAnalysis.count();
    execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: "file:" + file }, stdio: "pipe" });
    const after = await prisma.replayJournalEntry.findFirstOrThrow({ where: { logicalKey: before.logicalKey, projectionId } });
    expect(after.review).toBe(before.review); entryId = after.id;
    expect(await prisma.aiAnalysis.count()).toBe(reports);
  });
  it("distinguishes FIFO rows from closed trades, deducts fees once and excludes missing risk", () => {
    const result = sessionMetrics([
      { grossPnl: 10, fees: 2, plannedRisk: 4, status: "CLOSED" },
      { grossPnl: -3, fees: 1, plannedRisk: null, status: "CLOSED" },
      { grossPnl: 50, fees: 1, plannedRisk: 10, status: "OPEN" },
    ], [{ review: "笔记", setupOptionId: null }, { review: "", setupOptionId: null }, { review: "", setupOptionId: null }]);
    expect(result).toMatchObject({ journalRows: 3, closedTrades: 2, openTrades: 1, netPnl: 4, winRatePercent: 50, meanPlannedRiskR: 2, missingRiskTrades: 1 });
  });
});
