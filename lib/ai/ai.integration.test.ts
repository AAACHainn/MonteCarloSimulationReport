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
import { skillKeys, type RunInput } from "./schema";
import { executeReadTool, emptyFilters, scopeManifest, tradeRef, type ToolScope } from "./tools";
import { generateTurn } from "./provider";
import { executeChartTool, chartRef, chartDirectory } from "./chart-tools";
import { coverageLedger } from "./program-evidence";
import { saveAsset, storeChartAsset } from "./assets";
import { listChartCaptures, claimChartCapture, finishChartCapture, requestChartImage } from "./chart-captures";
import { chartWarmupCount } from "./chart-images-contract";
import { toolDefinitions } from "./tools";
import { defaultChartPreferences } from "./chart-contract";
import { entryLotId, fifoRowId } from "@/lib/paper-trading/journal-identity";
import { prepareAssistant, type AssistantDecision } from "./assistant-plan";
import { relevantHistory } from "./history";
import { DEFAULT_LIMITS, outputCharLimit } from "./limits";
import { executeDisplayImages, loadDisplayedImages, retainInterruptedImageReply } from "./display-images";
import type { DisplayedImage } from "./display-images-contract";
import { personalizationSchema } from "./schema";
import { copy } from "@/lib/i18n";
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
const capturePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=";
const captureFixture = (contextId: string) => async (_variantId: string, chart: import("./context").ContextChart) => storeChartAsset(capturePng, contextId, chart.hash);
async function withCaptureBrowser<T>(runId: string, action: () => Promise<T>) {
  let stopped = false;
  const pump = (async () => {
    while (!stopped) {
      for (const task of await listChartCaptures([runId])) {
        const job = await claimChartCapture(task.id);
        await finishChartCapture(job.id, job.lease, { dataUrl: capturePng });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();
  try { return await action(); } finally { stopped = true; await pump; }
}
describe("AI reply image attachments", () => {
  const apiContext = (path: string[]) => ({ params: Promise.resolve({ path }) });
  const toolResult = (message: { content: string | Array<{ type: string; text: string }> }) => JSON.parse(typeof message.content === "string" ? message.content : message.content.find((p) => p.type === "text")!.text);
  it.each(["generic", "deepseek"] as const)("publishes selected images before the answer, deduplicates and restores history (%s)", async (adapterProfile) => {
    await configure(); const settings = await readSettings(); settings.value.endpoints[0].adapterProfile = adapterProfile; await saveSettings(settings.value, settings.version);
    const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, timeframes: ["5m", "1h"] });
    const run = await makeRun(context.id, "globalAssistant", "tools-v1");
    const events: Array<{ type: string; images?: DisplayedImage[] }> = [];
    const mock = vi.fn().mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body), round = mock.mock.calls.length;
      if (round === 1) return toolResponse([{ id: "read-images", name: "get_chart_images", args: { chartRef: null, timeframes: null, cursor: null } }]);
      const result = toolResult(request.messages.find((m: { tool_call_id: string }) => m.tool_call_id === "read-images"));
      const images = result.data.charts.map((chart: { image: { assetRef: string }; variantRef: string }) => ({ assetRef: chart.image.assetRef,
        sourceRef: result.sources.find((r: { variantRef: string; evidenceKind: string }) => r.variantRef === chart.variantRef && r.evidenceKind === "CHART_IMAGE").sourceRef }));
      if (round === 2) return toolResponse([{ id: "publish-images", name: "display_images", args: { images: [...images, images[0]] } }]);
      if (round === 3) return toolResponse([{ id: "repeat-images", name: "display_images", args: { images: [images[0]] } }]);
      expect(request.messages.filter((m: { tool_call_id: string }) => ["publish-images", "repeat-images"].includes(m.tool_call_id)).every((m: Parameters<typeof toolResult>[0]) => toolResult(m).ok)).toBe(true);
      return streamResponse("已附上两个周期的图表。");
    });
    vi.stubGlobal("fetch", mock);
    await withCaptureBrowser(run.id, () => executeRun(run.id, (event) => events.push(event as typeof events[number])));
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    const images = (await loadDisplayedImages([run.id])).get(run.id)!;
    expect(images).toHaveLength(2); expect(images.map((image) => image.timeframe)).toEqual(["5m", "1h"]);
    expect(events.findIndex((event) => event.type === "images_updated" && event.images?.length === 2)).toBeLessThan(events.findIndex((event) => event.type === "delta"));
    const history = await (await aiGET(new Request(`http://localhost/api/ai/conversations/${run.conversationId}`), apiContext(["conversations", run.conversationId]))).json();
    expect(history.messages.find((m: { role: string }) => m.role === "assistant").images).toEqual(images);
    expect(history.messages.find((m: { role: string }) => m.role === "user").images).toEqual([]);
    const state = await (await aiGET(new Request(`http://localhost/api/ai/runs/${run.id}`), apiContext(["runs", run.id]))).json();
    expect(state.images).toEqual(images); expect(JSON.stringify(state)).not.toContain("data:image");
    const download = await aiGET(new Request(`http://localhost/api/ai/assets/${images[0].assetId}?download=1`), apiContext(["assets", images[0].assetId]));
    expect(download.headers.get("content-disposition")).toContain("attachment;"); expect(download.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await download.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("requires a matching successful image receipt from this run and verifies saved content", async () => {
    const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, timeframes: ["5m"] });
    const scope = { id: "display-scope", secret: "display-secret", context }, signal = new AbortController().signal;
    const chart = await executeChartTool(scope, context.id, { chartRef: null, timeframes: null, cursor: null }, signal, [], captureFixture(context.id));
    const args = { images: chart.images.map((image) => ({ assetRef: image.assetId, sourceRef: image.sourceRef })) };
    const call = { runId: scope.id, name: "get_chart_images", status: "COMPLETED", contractVersion: "2", result: JSON.stringify(chart.result) };
    for (const calls of [[], [{ ...call, runId: "other-run" }], [{ ...call, status: "FAILED" }]]) {
      const rejected = await executeDisplayImages(scope, context.id, args, calls, signal);
      expect(rejected.ok).toBe(false); expect(rejected.error?.code).toBe("NOT_FOUND_IN_SCOPE");
    }
    expect((await executeDisplayImages(scope, context.id, { images: [{ ...args.images[0], sourceRef: "source:invented" }] }, [call], signal)).ok).toBe(false);
    expect((await executeDisplayImages(scope, context.id, { images: [{ ...args.images[0], url: "https://example.com/image.png" }] }, [call], signal)).error?.code).toBe("INVALID_ARGUMENTS");
    expect((await executeDisplayImages(scope, context.id, args, [call], signal)).ok).toBe(true);
    await prisma.aiAsset.update({ where: { id: args.images[0].assetRef }, data: { contentHash: "0".repeat(64) } });
    expect((await executeDisplayImages(scope, context.id, args, [call], signal)).error?.code).toBe("IMAGE_UNAVAILABLE");
  });

  it("retains a cancelled image reply in chat history without duplicating or resurrecting cleared messages", async () => {
    await configure(); const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, timeframes: ["5m"] });
    const run = await makeRun(context.id, "globalAssistant", "tools-v1");
    const mock = vi.fn().mockImplementation(async (_url, options) => {
      if (mock.mock.calls.length === 1) return toolResponse([{ id: "read", name: "get_chart_images", args: { chartRef: null, timeframes: null, cursor: null } }]);
      if (mock.mock.calls.length === 2) {
        const result = toolResult(JSON.parse(options.body).messages.find((m: { role: string }) => m.role === "tool"));
        return toolResponse([{ id: "show", name: "display_images", args: { images: [{ assetRef: result.data.charts[0].image.assetRef, sourceRef: result.sources.find((r: { evidenceKind: string }) => r.evidenceKind === "CHART_IMAGE").sourceRef }] } }]);
      }
      await cancelRun(run.id); return streamResponse("此回答不应保存为成功");
    }); vi.stubGlobal("fetch", mock);
    await withCaptureBrowser(run.id, () => executeRun(run.id));
    await retainInterruptedImageReply(run.id);
    const replies = await prisma.aiMessage.findMany({ where: { runId: run.id, role: "assistant" } });
    expect(replies).toHaveLength(1); expect(replies[0].status).toBe("CANCELLED");
    expect((await loadDisplayedImages([run.id])).get(run.id)).toHaveLength(1);
    const clear = await aiPOST(new Request(`http://localhost/api/ai/conversations/${run.conversationId}/clear`, { method: "POST", headers: { Origin: "http://localhost" } }), apiContext(["conversations", run.conversationId, "clear"]));
    expect(clear.status).toBe(200); await retainInterruptedImageReply(run.id);
    expect(await prisma.aiMessage.count({ where: { conversationId: run.conversationId } })).toBe(0);
  });
});

describe("configurable per-run limits and usage API", () => {
  it.each([{ maxModelCalls: 9, maxToolCalls: 16, expected: 9 }, { maxModelCalls: 10, maxToolCalls: 2, expected: 3 }])("uses configured model/tool counts with a reserved closing answer (%j)", async ({ maxModelCalls, maxToolCalls, expected }) => {
    await configure(); const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const chat = await prisma.aiConversation.create({ data: { name: "tool-limits" } });
    const run = await createRun({ conversationId: chat.id, contextId: ctx.id, task: "globalAssistant", question: "继续查询", executionMode: "tools-v1", requestId: randomUUID(), assetIds: [], chartImages: false,
      limits: { maxModelCalls, maxToolCalls, inputChars: 128000, maxInputChars: 1000000 } });
    const mock = vi.fn().mockImplementation(async (_url, options) => JSON.parse(options.body).tool_choice === "none" ? streamResponse("按已读范围回答") : toolResponse([{ id: "configured-" + mock.mock.calls.length, name: "get_review_template", args: {} }]));
    vi.stubGlobal("fetch", mock); await executeRun(run.id);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED"); expect(mock).toHaveBeenCalledTimes(expected);
    expect(await prisma.aiToolCall.count({ where: { runId: run.id } })).toBe(expected - 1);
  });
  it("saves defaults, freezes overrides and retries an input-limited question with higher limits and the original scope/model", async () => {
    await configure(); const settings = await readSettings();
    settings.value.limits = { ...DEFAULT_LIMITS, outputTokens: 2048 };
    settings.value.skills.globalAssistant.prompt = "原任务提示：" + "x".repeat(12000);
    await saveSettings(settings.value, settings.version);
    const chat = await prisma.aiConversation.create({ data: { name: "limits" } });
    const run = await createRun({ conversationId: chat.id, task: "globalAssistant", question: "原来的问题", assetIds: [], chartImages: false, requestId: randomUUID(), limits: { outputTokens: 512, inputChars: 8000 } });
    const updated = await readSettings(); updated.value.limits = { ...DEFAULT_LIMITS, outputTokens: 4096 }; updated.value.endpoints[0].defaultModel = "changed";
    await saveSettings(updated.value, updated.version);
    const mock = vi.fn().mockImplementation(async () => streamResponse("完成原问题")); vi.stubGlobal("fetch", mock);
    await executeRun(run.id); expect(mock).not.toHaveBeenCalled();
    const failed = await aiGET(new Request("http://localhost/api/ai/runs/" + run.id), { params: Promise.resolve({ path: ["runs", run.id] }) });
    expect(await failed.json()).toMatchObject({ status: "FAILED", budget: { limits: { outputTokens: 512, inputChars: 8000 }, totalTokens: null, blocked: { resource: "inputChars", limit: 8000 } } });
    const response = await aiPOST(new Request("http://localhost/api/ai/runs/" + run.id + "/retry", { method: "POST", headers: { Origin: "http://localhost" }, body: JSON.stringify({ limits: { inputChars: 32000, outputTokens: 8192 } }) }), { params: Promise.resolve({ path: ["runs", run.id, "retry"] }) });
    expect(response.status).toBe(200); const retry = await response.json();
    await executeRun(retry.id);
    const request = JSON.parse(mock.mock.calls[0][1].body);
    expect(request.max_tokens).toBe(8192); expect(request.model).toBe("test"); expect(JSON.stringify(request.messages)).toContain("原来的问题");
    const result = await aiGET(new Request("http://localhost/api/ai/conversations/" + chat.id), { params: Promise.resolve({ path: ["conversations", chat.id] }) });
    const messages = (await result.json()).messages;
    expect(messages.find((m: { role: string }) => m.role === "assistant")).toMatchObject({ budget: { totalTokens: 15, lastUsage: { input: 10, output: 5 }, limits: { outputTokens: 8192, inputChars: 32000 } } });
    expect((await readSettings()).value.limits?.outputTokens).toBe(4096);
    await expect(retryRun(run.id, { inputChars: 7999 })).rejects.toThrow();
  });
  it("freezes planning limits across global edits and accounts for routing only once", async () => {
    await configure(); const chat = await prisma.aiConversation.create({ data: { name: "planning-limits" } }), question = "什么是回撤？";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify({ task: "globalAssistant", target: "none", tradeNo: null, timeframes: [], needsTemplate: false, fullCharts: false }))));
    const plan = await prepareAssistant({ conversationId: chat.id, question, limits: { outputTokens: 8192 } }, new AbortController().signal);
    const settings = await readSettings(); settings.value.limits = { ...DEFAULT_LIMITS, outputTokens: 2048 }; await saveSettings(settings.value, settings.version);
    const input: RunInput = { conversationId: chat.id, question, task: plan.task, planId: plan.planId, chartImages: false, assetIds: [], requestId: randomUUID() };
    await expect(createRun({ ...input, limits: { outputTokens: 4096 } })).rejects.toMatchObject({ code: "PLAN_EXPIRED" });
    const run = await createRun(input);
    const mock = vi.fn().mockImplementation(async () => streamResponse("解释回撤")); vi.stubGlobal("fetch", mock);
    await executeRun(run.id); expect(JSON.parse(mock.mock.calls[0][1].body).max_tokens).toBe(8192);
    const result = await aiGET(new Request("http://localhost/api/ai/runs/" + run.id), { params: Promise.resolve({ path: ["runs", run.id] }) });
    expect(await result.json()).toMatchObject({ budget: { modelCalls: 2, totalTokens: 30, limits: { outputTokens: 8192 } } });
    const retry = await retryRun(run.id); await executeRun(retry.id);
    const retried = await aiGET(new Request("http://localhost/api/ai/runs/" + retry.id), { params: Promise.resolve({ path: ["runs", retry.id] }) });
    expect(await retried.json()).toMatchObject({ budget: { modelCalls: 1, totalTokens: 15 } });
  });
  it("preserves usage and the precise output cap of a failed tool round, then adjusts it on retry", async () => {
    await configure(); const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const run = await makeRun(ctx.id, "globalAssistant", "tools-v1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("部分", "length", true, "实际思考")));
    await executeRun(run.id);
    const failed = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(JSON.parse(failed.usage)).toEqual([{ input: 10, output: 5 }]);
    expect(JSON.parse(failed.snapshot)).toMatchObject({ budgetExceeded: { resource: "outputTokens", limit: 4096 }, response: { usage: { input: 10, output: 5 }, outputTokenLimit: 4096 } });
    const retry = await retryRun(run.id, { outputTokens: 16384 });
    expect(JSON.parse(retry.snapshot).budgetExceeded).toBeUndefined(); expect(JSON.parse(retry.snapshot).limits.outputTokens).toBe(16384);
    await cancelRun(retry.id);
  });
  it("raises limits on resume without resetting completed batches or cumulative counters", async () => {
    await configure(); const ctx = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const run = await makeRun(ctx.id, "sessionReview", "tools-v1"); await cancelRun(run.id);
    await prisma.aiRun.update({ where: { id: run.id }, data: { calls: 7, usage: JSON.stringify([{ input: 123, output: 4 }]), checkpoint: '[{"content":"已完成批次","usage":{"input":123,"output":4}}]', snapshot: JSON.stringify({ ...JSON.parse(run.snapshot), estimatedChars: 51000, budgetExceeded: { resource: "maxAnalysisCalls", used: 751, limit: 750 } }) } });
    await resumeRun(run.id, { maxAnalysisCalls: 1000, outputTokens: 8192 });
    const resumed = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(resumed).toMatchObject({ status: "QUEUED", calls: 7, contextId: ctx.id });
    expect(JSON.parse(resumed.snapshot)).toMatchObject({ estimatedChars: 51000, limits: { maxAnalysisCalls: 1000, outputTokens: 8192 } });
    expect(JSON.parse(resumed.snapshot).budgetExceeded).toBeUndefined(); expect(resumed.checkpoint).toContain("已完成批次"); expect(JSON.parse(resumed.usage)).toEqual([{ input: 123, output: 4 }]);
    await cancelRun(run.id);
  });
});
describe("automatic assistant intent and page scope", () => {
  const decision = (value: Partial<AssistantDecision>): AssistantDecision => ({ task: "globalAssistant", target: "current", tradeNo: null, timeframes: [], needsTemplate: false, fullCharts: false, needsChartImages: false, multipleCharts: false, ...value });
  async function plan(value: Partial<AssistantDecision>, page?: { entryId?: string; draft?: string; templateId?: string; includeCurrentChart?: boolean }, question = "分析这里") {
    await configure();
    const chat = await prisma.aiConversation.create({ data: { name: "auto" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify(decision(value)))));
    return { chat, result: await prepareAssistant({ conversationId: chat.id, question, page: {
      replaySessionId: sessionId, projectionId, depth: "quick", chartAccess: true, includeCurrentChart: false, ...page,
    } }, new AbortController().signal) };
  }
  it("uses the live editor's explicitly empty draft and selected template, then validates adoption without saving", async () => {
    const template = await prisma.replayReviewTemplate.create({ data: { name: "auto-template", normalizedName: "auto-template", content: "计划\n执行\n改进" } });
    const { chat, result } = await plan({ task: "reviewDraft" }, { entryId, draft: "", templateId: template.id }, "按当前模板整理复盘正文");
    expect(result.task).toBe("reviewDraft"); expect(result.context?.originalDraft).toBe(""); expect(result.context?.template?.id).toBe(template.id);
    const run = await createRun({ conversationId: chat.id, contextId: result.context!.id, task: result.task, question: "整理正文", assetIds: [], chartImages: false, requestId: randomUUID() });
    let count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (!count++) return toolResponse([
        { id: "auto-facts", name: "get_trade_record", args: { tradeRef: JSON.parse(body.messages.at(-1).content).scopeManifest.selection.selectedTradeRef, sections: ["facts"], cursor: null, limit: null } },
        { id: "auto-template", name: "get_review_template", args: {} },
      ]);
      const facts = body.messages.find((m: { tool_call_id?: string }) => m.tool_call_id === "auto-facts");
      return streamResponse(JSON.stringify({ draft: "根据事实生成的待保存草稿", analysis: "", sources: [JSON.parse(facts.content).sources[0].sourceRef], missing: [] }));
    }));
    await executeRun(run.id);
    const message = await prisma.aiMessage.findFirstOrThrow({ where: { runId: run.id, role: "assistant" } });
    expect(message.status).toBe("COMPLETED");
    const response = await aiPOST(new Request("http://localhost/api/ai/adopt/" + message.id, { method: "POST", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ path: ["adopt", message.id] }) });
    expect(response.status).toBe(200); expect((await response.json()).originalDraft).toBe("");
    expect((await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } })).review).toBe("原始复盘");
  });
  it("keeps numbered trade questions in the current session, allowing autonomous list, detail and chart reads", async () => {
    const { chat, result } = await plan({ target: "trade_number", tradeNo: 1 }, undefined, "为什么第1笔这样执行？");
    const context = result.context!; expect(context.selectedEntryId).toBeUndefined();
    const run = await createRun({ conversationId: chat.id, contextId: context.id, task: result.task, question: "解释第1笔", assetIds: [], chartImages: false, requestId: randomUUID() });
    let count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (count++ === 0) return toolResponse([{ id: "auto-list", name: "list_trade_records", args: { filters: { ...emptyFilters, displayNo: 1 }, cursor: null, limit: 10 } }]);
      const list = JSON.parse(body.messages.find((m: { tool_call_id?: string }) => m.tool_call_id === "auto-list").content);
      if (count === 2) return toolResponse([{ id: "auto-detail", name: "get_trade_record", args: { tradeRef: list.data.records[0].tradeRef, sections: ["facts"], cursor: null, limit: null } },
        { id: "auto-chart", name: "get_chart_images", args: { chartRef: list.data.records[0].chartRef, timeframes: ["5m"], cursor: null } }]);
      return streamResponse("已在本会话定位第1笔，并读取事实和截至平仓的图表数据。");
    }));
    await withCaptureBrowser(run.id, () => executeRun(run.id));
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    expect(await prisma.aiToolCall.count({ where: { runId: run.id, status: "COMPLETED" } })).toBe(3);
  });
  it("routes a report and its ordinary follow-up separately instead of inheriting the report workflow", async () => {
    const report = await plan({ task: "sessionReview", target: "session" }, { entryId }, "总结整个会话");
    expect(report.result.task).toBe("sessionReview"); expect(report.result.context?.selectedEntryId).toBeUndefined();
    const followup = await plan({ task: "globalAssistant", target: "session" }, undefined, "你刚才说的执行问题具体指什么？");
    expect(followup.result.task).toBe("globalAssistant"); expect(followup.result.context?.depth).toBe("quick");
  });
  it("clarifies missing scope, missing trade and ambiguous account numbering without starting runs", async () => {
    await configure(); const chat = await prisma.aiConversation.create({ data: { name: "clarify" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify(decision({ target: "current", task: "reviewDraft" })))));
    const missing = await prepareAssistant({ conversationId: chat.id, question: "帮我填写这笔复盘" }, new AbortController().signal);
    expect(missing.clarification).toBeTruthy(); expect(missing.context).toBeNull();
    expect((await plan({ target: "trade_number", tradeNo: 99 })).result.clarification).toContain("99");
    const journal = await prisma.replayJournalSession.create({ data: { datasetId: "market", replayGeneration: 2, initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0 } });
    const original = await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } });
    const other = await prisma.replayJournalEntry.create({ data: { ...original, id: "ambiguous-auto", journalSessionId: journal.id, no: 20, logicalKey: "ambiguous-auto" } });
    try { expect((await plan({ target: "trade_number", tradeNo: 1 })).result.clarification).toContain("多个账户"); }
    finally { await prisma.replayJournalEntry.delete({ where: { id: other.id } }); }
    expect(await prisma.aiRun.count({ where: { conversationId: chat.id } })).toBe(0);
  });
  it("answers general knowledge without business data and rejects malformed decisions or changed projections", async () => {
    expect((await plan({ target: "none" }, undefined, "什么是回撤？")).result.context).toBeNull();
    await configure(); const chat = await prisma.aiConversation.create({ data: { name: "invalid-plan" } });
    const fetchMock = vi.fn().mockResolvedValue(streamResponse('{"task":"sql","target":"all_database"}')); vi.stubGlobal("fetch", fetchMock);
    await expect(prepareAssistant({ conversationId: chat.id, question: "分析" }, new AbortController().signal)).rejects.toMatchObject({ code: "ROUTING_INVALID" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(prepareAssistant({ conversationId: chat.id, question: "分析", page: { replaySessionId: sessionId, projectionId: "foreign", depth: "quick", chartAccess: true, includeCurrentChart: true } }, new AbortController().signal)).rejects.toMatchObject({ code: "CONTEXT_CONFLICT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reads current revealed charts and on-demand trade charts under the same frozen cutoff", async () => {
    const { result } = await plan({ task: "chartReading", timeframes: ["5m", "1h"] }, { includeCurrentChart: true }, "比较当前5m和1h走势");
    const context = result.context!, scope = { id: "auto-charts", secret: "auto-charts", context }, signal = new AbortController().signal;
    expect(context.currentChart).toBeTruthy(); expect(result.prepareImages).toBe(true);
    const current = await executeChartTool(scope, context.id, { chartRef: chartRef(scope, context.currentChart!), timeframes: ["5m", "1h"], cursor: null }, signal, [], captureFixture(context.id));
    expect(current.result.ok).toBe(true); expect(JSON.stringify(current)).not.toContain("98765432");
    const fresh = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick", chartAccess: true });
    const lazyScope = { ...scope, context: fresh, imageRequest: { multiple: true, timeframes: [] } };
    const raw = { chartRef: chartRef(lazyScope, fresh.entries[0]), timeframes: ["1h"], cursor: null };
    expect(fresh.charts).toHaveLength(0);
    const read = await executeChartTool(lazyScope, fresh.id, raw, signal, [], captureFixture(fresh.id));
    expect(read.result.ok).toBe(true); expect(JSON.stringify(read)).not.toContain("98765432");
    await prisma.marketDataset.update({ where: { id: "market" }, data: { dataVersion: { increment: 1 } } });
    try { expect((await executeChartTool(lazyScope, fresh.id, { ...raw, timeframes: ["15m"] }, signal, [])).result.error?.code).toBe("STALE_CONTEXT"); }
    finally { await prisma.marketDataset.update({ where: { id: "market" }, data: { dataVersion: { decrement: 1 } } }); }
  });
  it("carries discussion across fresh snapshots of the same object, with other scopes excluded", async () => {
    await configure(); const chat = await prisma.aiConversation.create({ data: { name: "history-scope" } });
    const first = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const previous = await createRun({ conversationId: chat.id, contextId: first.id, task: "globalAssistant", question: "previous-same-scope", assetIds: [], chartImages: false, requestId: randomUUID() });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("previous-answer"))); await executeRun(previous.id);
    const next = await createContext({ replaySessionId: sessionId, projectionId, depth: "quick" });
    const history = await relevantHistory(chat.id, next, "next-run");
    expect(history.map((m) => m.content)).toContain("previous-answer");
    const single = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    expect(await relevantHistory(chat.id, single, "next-run")).toHaveLength(0);
    expect(await relevantHistory(chat.id, null, "next-run")).toHaveLength(0);
  });
  it("keeps a panned chart within its visible source range and a pinned follow-up at the old cutoff", async () => {
    await configure(); const chat = await prisma.aiConversation.create({ data: { name: "visible-chart" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify(decision({ task: "chartReading" })))));
    const result = await prepareAssistant({ conversationId: chat.id, question: "分析当前可见图表", page: { replaySessionId: sessionId, projectionId,
      depth: "quick", chartAccess: true, includeCurrentChart: true, chartWindow: { fromSequence: 0, toSequence: 2, displayIntervalSeconds: 60, displaySession: "ETH" } } }, new AbortController().signal);
    expect(result.context!.charts.every((c) => c.window.bars.every((b) => b.lastSequence <= 2))).toBe(true);
    expect(result.context!.chartPlans!.filter((p) => p.entryId === result.context!.currentChart!.id).every((p) => p.endSequence === 2)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify(decision({ task: "chartReading", timeframes: ["1h"] })))));
    const pinned = await prepareAssistant({ conversationId: chat.id, question: "再看1h", contextId: result.context!.id }, new AbortController().signal);
    expect(pinned.context!.id).toBe(result.context!.id); expect(pinned.context!.currentChart!.closedAt).toBe(result.context!.currentChart!.closedAt);
  });
  it("persists the actual routing usage once, rejects changed plans and reuses routing on explicit retry", async () => {
    const { chat, result } = await plan({ target: "none" }, undefined, "什么是回撤？");
    const input = { conversationId: chat.id, task: result.task, planId: result.planId, question: "什么是回撤？", assetIds: [], chartImages: false, requestId: randomUUID() };
    await expect(createRun({ ...input, question: "different" })).rejects.toMatchObject({ code: "PLAN_EXPIRED" });
    const run = await createRun(input);
    expect((await createRun(input)).id).toBe(run.id);
    const routing = await prisma.aiRunStep.findUniqueOrThrow({ where: { runId_stepNo: { runId: run.id, stepNo: 0 } } });
    expect(routing.phase).toBe("ROUTING"); expect(JSON.parse(routing.usage)).toEqual({ input: 10, output: 5 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("回撤是从权益峰值的下降。"))); await executeRun(run.id);
    expect(JSON.parse((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).usage)).toHaveLength(2);
    const retry = await retryRun(run.id);
    expect(JSON.parse(retry.snapshot).routing.reused).toBe(true); expect(JSON.parse(retry.usage)).toHaveLength(0);
    await cancelRun(retry.id);
  });
  it("includes the routing call in the existing six-call budget and reserves a closing answer", async () => {
    const { chat, result } = await plan({}, undefined, "核对当前会话资料");
    const run = await createRun({ conversationId: chat.id, task: result.task, contextId: result.context!.id, planId: result.planId,
      question: "核对当前会话资料", assetIds: [], chartImages: false, requestId: randomUUID() });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, options) => {
      calls++;
      if (calls < 5) return toolResponse([{ id: "budget-" + calls, name: "get_review_template", args: {} }]);
      expect(JSON.parse(options.body).tool_choice).toBe("none"); return streamResponse("只读取了模板状态，交易事实仍待核对。");
    }));
    await executeRun(run.id);
    expect(calls).toBe(5);
    const saved = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("COMPLETED"); expect(JSON.parse(saved.usage)).toHaveLength(6);
  });
});
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
  it("only warms up visible indicators and retains a bounded maximum", () => {
    const prefs = defaultChartPreferences(0);
    prefs.emaEnabled = true;
    prefs.emaIndicators = [20, 60, 200].map((length) => ({ id: String(length), length, color: "#000000", lineWidth: 1, lineStyle: "SOLID", visible: length === 20 }));
    expect(chartWarmupCount(prefs)).toBe(60);
    prefs.emaIndicators[2].visible = true; expect(chartWarmupCount(prefs)).toBe(600);
    prefs.emaIndicators[2].length = 1000; expect(chartWarmupCount(prefs)).toBe(1000);
    prefs.emaEnabled = false; expect(chartWarmupCount(prefs)).toBe(0);
  });
  it("prepares requested chart images independently of the answer mode and publishes only the image tool", async () => {
    await configure(); const chat = await prisma.aiConversation.create({ data: { name: "image-intent" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify({ task: "globalAssistant", target: "current", tradeNo: null, timeframes: [], needsTemplate: false, fullCharts: false, needsChartImages: true, multipleCharts: false }))));
    const result = await prepareAssistant({ conversationId: chat.id, question: "你可以调用工具生成图片查看当前图表吗？", page: { replaySessionId: sessionId, projectionId, depth: "quick", chartAccess: true, includeCurrentChart: true } }, new AbortController().signal);
    expect(result.task).toBe("globalAssistant"); expect(result.prepareImages).toBe(true); expect(result.imageRequest).toEqual({ multiple: false, timeframes: [] });
    const scope = { id: "images", secret: "images", context: result.context! };
    expect(toolDefinitions(scope).map((d) => d.function.name)).toContain("get_chart_images");
    expect(toolDefinitions(scope).map((d) => d.function.name)).not.toContain("get_chart_context");
    const rejected = await executeChartTool(scope, result.context!.id, { chartRef: null, timeframes: ["1m", "5m"], cursor: null }, new AbortController().signal, [], captureFixture(result.context!.id));
    expect(rejected.result.ok).toBe(false);
  });
  it("delivers three newly captured periods through persisted browser requests without sending OHLC arrays", async () => {
    await configure(); const context = await createContext({ replaySessionId: sessionId, projectionId, includeCurrentChart: true, chartAccess: true, timeframes: ["1m", "5m", "15m"] });
    const run = await makeRun(context.id, "globalAssistant", "tools-v1");
    const mock = vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (mock.mock.calls.length === 1) return toolResponse([{ id: "new-images", name: "get_chart_images", args: { chartRef: null, timeframes: null, cursor: null } }]);
      const imageParts = body.messages.flatMap((m: { content: unknown }) => Array.isArray(m.content) ? m.content.filter((p) => p.type === "image_url") : []);
      expect(imageParts).toHaveLength(3); expect(imageParts.every((p: { image_url: { url: string } }) => p.image_url.url.startsWith("data:image/png;base64,"))).toBe(true);
      const result = JSON.parse(body.messages.find((m: { role: string }) => m.role === "tool").content);
      expect(result.data.charts.map((c: { timeframe: string }) => c.timeframe)).toEqual(["1m", "5m", "15m"]);
      expect(JSON.stringify(result)).not.toMatch(/"(?:bars|warmupBars|open|high|low|close|volume)":/);
      return streamResponse("三张固定范围图片已读取");
    }); vi.stubGlobal("fetch", mock);
    await withCaptureBrowser(run.id, () => executeRun(run.id));
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    const tasks = await prisma.aiRunStep.findMany({ where: { runId: run.id, phase: "CAPTURE" } });
    expect(tasks).toHaveLength(3); expect(tasks.every((t) => t.stepNo < 0 && t.status === "READY")).toBe(true);
  });
  it("keeps the same window and prepared image when one period is requested alone or with another", async () => {
    const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", timeframes: ["5m", "1h"] });
    const assets = await Promise.all(context.charts.map((c) => saveAsset(capturePng, context.id, c.hash)));
    const scope = { id: "stable-images", secret: "stable", context }, signal = new AbortController().signal;
    const one = await executeChartTool(scope, context.id, { chartRef: null, timeframes: ["5m"], cursor: null }, signal, assets.map((a) => a.id));
    const two = await executeChartTool(scope, context.id, { chartRef: null, timeframes: ["5m", "1h"], cursor: null }, signal, assets.map((a) => a.id));
    expect(one.images[0]).toEqual(two.images[0]);
    expect(one.result.ok && (one.result.data.charts as Array<{ windowHash: string }>)[0].windowHash).toBe(two.result.ok && (two.result.data.charts as Array<{ windowHash: string }>)[0].windowHash);
    expect(await prisma.aiChartVariant.count({ where: { contextId: context.id } })).toBe(2);
  });
  it("sends a frozen current-chart annotation list to the browser with captions, legends and real trade mappings", async () => {
    await configure(); const c = await createContext({ replaySessionId: sessionId, projectionId, includeCurrentChart: true, chartAccess: true, timeframes: ["1m", "5m"] });
    const run = await makeRun(c.id, "globalAssistant", "tools-v1"), signal = new AbortController().signal;
    await prisma.aiRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
    const scope = { id: run.id, secret: "annotations", context: c };
    const waiting = executeChartTool(scope, c.id, { chartRef: null, timeframes: null, cursor: null }, signal, [], (id, ch) => requestChartImage(run.id, c.id, id, ch, signal, () => undefined));
    let taskId = ""; await vi.waitFor(async () => { const tasks = await listChartCaptures([run.id]); expect(tasks).toHaveLength(1); taskId = tasks[0].id; });
    const job = await claimChartCapture(taskId);
    expect(job.chart.entryId).toBe("current-replay-chart");
    expect(job.chart.annotations?.entries.map((e) => e.id)).toEqual([entryId]);
    expect(job.chart.annotations?.entries[0]).toMatchObject({ no: c.entries[0].no, openedSequence: 1, closedSequence: 3 });
    expect(job.context.entries).toEqual([]);
    await finishChartCapture(job.id, job.lease, { dataUrl: capturePng });
    const output = await withCaptureBrowser(run.id, () => waiting);
    expect(output.images).toHaveLength(2);
    expect(output.result.ok && output.result.data).toMatchObject({ subject: { kind: "CURRENT_CHART", tradeRef: null },
      annotationLegend: { risk: expect.stringContaining("持仓结束后"), exit: expect.stringContaining("不能据此判断") },
      annotationMapping: [{ chartNo: c.entries[0].no, displayNo: c.entries[0].no, globalNo: c.entries[0].globalNo, journalAccount: c.entries[0].journalSessionId, tradeRef: tradeRef(scope, c.entries[0]) }] });
    const charts = output.result.ok ? output.result.data.charts as Array<{ caption: string; annotationNumbers: number[] }> : [];
    expect(charts.every((ch) => Boolean(ch.caption) && ch.annotationNumbers[0] === c.entries[0].no)).toBe(true);
    expect(JSON.stringify(output)).not.toMatch(/"(?:bars|warmupBars|open|high|low|close|volume)":/);
    await cancelRun(run.id);
  });
  it("reconstructs old unannotated images under a new identity without overwriting historical assets", async () => {
    const c = await createContext({ replaySessionId: sessionId, projectionId, includeCurrentChart: true, chartAccess: true });
    c.charts = c.charts.map((ch) => ({ ...ch, annotations: undefined, hash: "legacy:" + ch.hash }));
    const { id, ...value } = c;
    await prisma.aiContext.update({ where: { id }, data: { value: JSON.stringify(value) } });
    const previous = await saveAsset(capturePng, id, c.charts[0].hash), capture = vi.fn(captureFixture(id));
    const output = await executeChartTool({ id: "legacy-images", secret: "legacy", context: c }, id, { chartRef: null, timeframes: null, cursor: null }, new AbortController().signal, [previous.id], capture);
    expect(output.images).toHaveLength(1); expect(output.images[0].assetId).not.toBe(previous.id); expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1].annotations?.entries.map((e) => e.id)).toEqual([entryId]);
    expect(await prisma.aiAsset.findUnique({ where: { id: previous.id } })).toMatchObject({ chartHash: c.charts[0].hash });
  });
  it("keeps four periods and the bounded annotation mapping within the tool result limit", async () => {
    const c = await createContext({ replaySessionId: sessionId, projectionId, includeCurrentChart: true, chartAccess: true, timeframes: ["1m", "5m", "15m", "1h"] });
    c.entries = Array.from({ length: 105 }, (_, i) => ({ ...c.entries[0], id: "annotation-" + i, no: i + 1, globalNo: i + 1, logicalKey: "annotation-key-" + i }));
    const output = await executeChartTool({ id: "many-annotations", secret: "many", context: c }, c.id, { chartRef: null, timeframes: null, cursor: null }, new AbortController().signal, [], captureFixture(c.id));
    expect(output.images).toHaveLength(4); expect(output.result.ok && output.result.data.annotationMapping).toHaveLength(100);
    expect(output.result.coverage.annotationsComplete).toBe(false); expect(output.result.warnings).toHaveLength(4);
    expect(Buffer.byteLength(JSON.stringify(output.result))).toBeLessThanOrEqual(32768);
  });
  it("completes multi-period pagination when the longer period has already ended", async () => {
    const datasetId = "image-pagination", count = 430;
    await prisma.marketDataset.create({ data: { id: datasetId, name: datasetId, symbol: "PAGE", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: count, startTime: base, endTime: new Date(+base + (count - 1) * 60000) } });
    await prisma.marketBar.createMany({ data: Array.from({ length: count }, (_, sequence) => ({ datasetId, sequence, timestamp: new Date(+base + sequence * 60000), open: 100, high: 102, low: 99, close: 101 })) });
    const session = await createReplaySession(datasetId, { name: datasetId, mode: "TRAINING", timestamp: base.toISOString(), playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    await prisma.replayProjection.update({ where: { id: session.activeProjectionId! }, data: { currentSequence: count - 1 } });
    const journal = await prisma.replayJournalSession.create({ data: { datasetId, replaySessionId: session.id, replayGeneration: 1, initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0 } });
    const original = await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entryId } });
    const entry = await prisma.replayJournalEntry.create({ data: { ...original, id: "pagination-entry", logicalKey: "pagination-entry", projectionId: session.activeProjectionId!, journalSessionId: journal.id, openedSequence: 0, openedAt: base, closedSequence: count - 1, closedAt: new Date(+base + (count - 1) * 60000), displayIntervalSeconds: 60 } });
    const context = await createContext({ replaySessionId: session.id, projectionId: session.activeProjectionId!, entryId: entry.id, timeframes: ["1m", "5m"] });
    const scope = { id: "pagination-images", secret: "pagination", context }, signal = new AbortController().signal;
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const output = await executeChartTool(scope, context.id, { chartRef: null, timeframes: null, cursor }, signal, [], captureFixture(context.id));
      expect(output.result.ok).toBe(true); expect(output.result.coverage.imagesComplete).toBe(true);
      expect(output.result.coverage.complete).toBe(page === 2); expect(output.images).toHaveLength(page ? 1 : 2);
      const charts = output.result.ok ? output.result.data.charts as Array<{ coverage: { visibleBars: number }; actualSourceRange: number[] }> : [];
      expect(charts[0].coverage.visibleBars).toBe(page === 2 ? 30 : 200);
      expect(charts[0].actualSourceRange).toEqual([page * 200, Math.min(count - 1, (page + 1) * 200 - 1)]);
      if (!page) expect(charts[1].coverage.visibleBars).toBe(86);
      if (page) expect(output.result.ok && (output.result.data.charts as Array<{ imageStatus: string }>)[1].imageStatus).toBe("NO_MORE_IMAGES");
      cursor = output.result.nextCursor;
    }
    expect(cursor).toBeNull();
    const current = await createContext({ replaySessionId: session.id, projectionId: session.activeProjectionId!, includeCurrentChart: true, chartAccess: true, timeframes: ["1m", "5m"], chartWindow: { fromSequence: 230, toSequence: 429, displayIntervalSeconds: 60, displaySession: "ETH" } });
    const currentScope = { ...scope, context: current, imageRequest: { multiple: false, timeframes: [] as string[] } };
    expect(chartDirectory(currentScope, current.currentChart!).maxBarsPerImage).toBe(200);
    const single = await executeChartTool(currentScope, current.id, { chartRef: null, timeframes: null, cursor: null }, signal, [], captureFixture(current.id));
    expect(single.images).toHaveLength(1);
    expect(single.result.ok && (single.result.data.charts as Array<{ coverage: { visibleBars: number }; actualSourceRange: number[] }>)[0]).toMatchObject({ coverage: { visibleBars: 200 }, actualSourceRange: [230, 429] });
    const multi = await executeChartTool({ ...currentScope, imageRequest: { multiple: true, timeframes: ["1m", "5m"] } }, current.id, { chartRef: null, timeframes: null, cursor: null }, signal, [], captureFixture(current.id));
    expect(multi.images).toHaveLength(2);
    expect(multi.result.ok && (multi.result.data.charts as Array<{ coverage: { visibleBars: number }; actualSourceRange: number[] }>)[0]).toMatchObject({ coverage: { visibleBars: 200 }, actualSourceRange: [230, 429] });
  });
  it("reclaims a lost browser lease, rejects stale completions, and makes completion idempotent", async () => {
    await configure(); const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const run = await makeRun(context.id, "globalAssistant", "tools-v1"); await prisma.aiRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
    const waiting = executeChartTool({ id: run.id, secret: "lease", context }, context.id, { chartRef: null, timeframes: null, cursor: null }, new AbortController().signal, [], (id, chart) => requestChartImage(run.id, context.id, id, chart, new AbortController().signal, () => undefined));
    let taskId = "";
    await vi.waitFor(async () => { const tasks = await listChartCaptures([run.id]); expect(tasks).toHaveLength(1); taskId = tasks[0].id; });
    const first = await claimChartCapture(taskId); await expect(claimChartCapture(taskId)).rejects.toMatchObject({ code: "CAPTURE_EXPIRED" });
    const saved = await prisma.aiRunStep.findUniqueOrThrow({ where: { id: taskId } }), state = JSON.parse(saved.payload);
    await prisma.aiRunStep.update({ where: { id: taskId }, data: { payload: JSON.stringify({ ...state, leaseUntil: Date.now() - 1 }) } });
    const second = await claimChartCapture(taskId); expect(second.lease).not.toBe(first.lease);
    await expect(finishChartCapture(taskId, first.lease, { dataUrl: capturePng })).rejects.toMatchObject({ code: "CAPTURE_EXPIRED" });
    const completed = await finishChartCapture(taskId, second.lease, { dataUrl: capturePng });
    expect(await finishChartCapture(taskId, second.lease, { dataUrl: capturePng })).toEqual(completed);
    expect((await waiting).images).toHaveLength(1); expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).calls).toBe(0);
    await cancelRun(run.id);
  });
  it("rejects an upload after cancellation and never turns the cancelled request ready", async () => {
    await configure(); const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const run = await makeRun(context.id, "globalAssistant", "tools-v1"); await prisma.aiRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
    const waiting = executeChartTool({ id: run.id, secret: "cancel", context }, context.id, { chartRef: null, timeframes: null, cursor: null }, new AbortController().signal, [], (id, chart) => requestChartImage(run.id, context.id, id, chart, new AbortController().signal, () => undefined));
    let taskId = ""; await vi.waitFor(async () => { const tasks = await listChartCaptures([run.id]); expect(tasks).toHaveLength(1); taskId = tasks[0].id; });
    const job = await claimChartCapture(taskId); await cancelRun(run.id);
    await expect(finishChartCapture(taskId, job.lease, { dataUrl: capturePng })).rejects.toMatchObject({ code: "CAPTURE_EXPIRED" });
    expect((await waiting).images).toHaveLength(0); expect((await prisma.aiRunStep.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("CANCELLED");
    expect(await prisma.aiAsset.count({ where: { contextId: context.id } })).toBe(0);
  });
  it("expires a capture request without a browser and reports the image-specific timeout", async () => {
    await configure(); const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const run = await makeRun(context.id, "globalAssistant", "tools-v1"); await prisma.aiRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
    const waiting = executeChartTool({ id: run.id, secret: "expire", context }, context.id, { chartRef: null, timeframes: null, cursor: null }, new AbortController().signal, [], (id, chart) => requestChartImage(run.id, context.id, id, chart, new AbortController().signal, () => undefined));
    let taskId = ""; await vi.waitFor(async () => { const tasks = await listChartCaptures([run.id]); expect(tasks).toHaveLength(1); taskId = tasks[0].id; });
    const task = await prisma.aiRunStep.findUniqueOrThrow({ where: { id: taskId } });
    await prisma.aiRunStep.update({ where: { id: taskId }, data: { payload: JSON.stringify({ ...JSON.parse(task.payload), deadline: Date.now() - 1 }) } });
    await expect(claimChartCapture(taskId)).rejects.toMatchObject({ code: "CAPTURE_EXPIRED" });
    expect((await waiting).result.error?.code).toBe("CHART_CAPTURE_TIMEOUT");
    expect((await prisma.aiRunStep.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("EXPIRED"); await cancelRun(run.id);
  });
  it("retains successful images when another period cannot be rendered", async () => {
    const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick", timeframes: ["5m", "1h"] });
    const output = await executeChartTool({ id: "partial-image", secret: "partial", context }, context.id, { chartRef: null, timeframes: null, cursor: null }, new AbortController().signal, [], async (id, chart) => {
      if (chart.intervalSeconds === 3600) throw new Error("capture unavailable"); return captureFixture(context.id)(id, chart);
    });
    expect(output.images).toHaveLength(1); expect(output.result.ok).toBe(true); expect(output.result.coverage.imagesComplete).toBe(false);
    expect(output.result.warnings).toContain("1h:CHART_CAPTURE_FAILED"); expect(JSON.stringify(output)).not.toContain('"bars"');
  });
  it("keeps earlier images after the shared capture deadline without starting more waits", async () => {
    const context = await createContext({ replaySessionId: sessionId, projectionId, entryId, timeframes: ["1m", "5m", "15m"] });
    const signal = new AbortController().signal;
    const output = await executeChartTool({ id: "capture-deadline", secret: "deadline", context }, context.id, { chartRef: null, timeframes: null, cursor: null }, signal, [], async (id, chart) => {
      if (chart.intervalSeconds === 60) return captureFixture(context.id)(id, chart);
      return requestChartImage("expired-batch", context.id, id, chart, signal, () => undefined, Date.now() - 1);
    });
    expect(output.result.ok).toBe(true); expect(output.images).toHaveLength(1); expect(output.result.coverage.imagesComplete).toBe(false);
    expect(output.result.warnings).toEqual(["5m:CHART_CAPTURE_TIMEOUT", "15m:CHART_CAPTURE_TIMEOUT"]);
    expect(await prisma.aiRunStep.count({ where: { runId: "expired-batch" } })).toBe(0);
  });
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
        return toolResponse([{ id: "images", name: "get_chart_images", args: { chartRef: manifest.selection.chartRef, timeframes: ["5m", "1h"], cursor: null } }]);
      }
      const results = request.messages.filter((m: { role: string }) => m.role === "tool");
      expect(results).toHaveLength(1); expect(results[0].tool_call_id).toBe("images");
      const content = results[0].content;
      const evidence = JSON.parse(typeof content === "string" ? content : content.find((part: { type: string }) => part.type === "text").text);
      expect(evidence.data.annotationLegend.entry).toContain("LMT");
      expect(evidence.data.annotationMapping).toMatchObject([{ displayNo: c.entries[0].no, globalNo: c.entries[0].globalNo, tradeRef: expect.stringMatching(/^trade:/) }]);
      expect(evidence.data.charts.every((ch: { caption?: string; annotationNumbers: number[] }) => Boolean(ch.caption) && ch.annotationNumbers.includes(c.entries[0].no))).toBe(true);
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
    const scope: ToolScope = { id: "chart-run", secret: "chart-secret", context: c, imageRequest: { multiple: true, timeframes: [] } }, signal = new AbortController().signal;
    const raw = { chartRef: chartRef(scope, c.entries[0]), timeframes: ["5m", "60m", "1h"], cursor: null };
    const missing = await executeChartTool(scope, c.id, raw, signal, []);
    expect(missing.result.error?.code).toBe("IMAGE_NOT_PREPARED");
    const response = await executeChartTool(scope, c.id, raw, signal, [], captureFixture(c.id));
    expect(response.result.ok).toBe(true);
    const charts = response.result.ok ? response.result.data.charts as Array<{ timeframe: string; cutoffSequence: number; imageStatus: string; windowHash: string }> : [];
    expect(charts.map((ch) => ch.timeframe)).toEqual(["5m", "1h"]);
    expect(charts.every((ch) => ch.cutoffSequence === 3 && ch.imageStatus === "READY")).toBe(true);
    expect(new Set(charts.map((ch) => ch.windowHash)).size).toBe(2);
    expect(JSON.stringify(response)).not.toContain('"bars"');
    expect(JSON.stringify(response)).not.toContain("98765432");
    const variants = await prisma.aiChartVariant.findMany({ where: { contextId: c.id } });
    expect(variants.every((v) => JSON.parse(v.value).window.bars.every((b: { lastSequence: number; status: string }) => b.lastSequence <= 3 && b.status === "FORMING"))).toBe(true);
    for (const timeframes of [[], ["1s"], ["1m", "5m", "15m", "1h", "4h"]]) expect((await executeChartTool(scope, c.id, { ...raw, timeframes }, signal, [])).result.ok).toBe(false);
    const before = await prisma.aiChartVariant.count({ where: { contextId: c.id } });
    await executeChartTool(scope, c.id, raw, signal, []);
    expect(await prisma.aiChartVariant.count({ where: { contextId: c.id } })).toBe(before);
    await prisma.marketDataset.update({ where: { id: c.datasetId }, data: { dataVersion: { increment: 1 } } });
    try {
      expect((await executeChartTool(scope, c.id, { ...raw, timeframes: ["15m"] }, signal, [])).result.error?.code).toBe("STALE_CONTEXT");
      expect((await executeChartTool(scope, c.id, raw, signal, [], captureFixture(c.id))).result.ok).toBe(true);
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
  it("defaults legacy assistant names and preserves a customized name when older clients save", async () => {
    await configure();
    const old = await readSettings();
    const legacy: Record<string, unknown> = { ...old.value };
    delete legacy.personalization;
    await prisma.aiSetting.update({ where: { id: "config" }, data: { value: JSON.stringify(legacy) } });
    expect((await readSettings()).value.personalization.name).toBe(copy.ai.title);
    const renamed = await saveSettings({ ...old.value, personalization: { name: "交易搭子" } }, old.version);
    const savedByOldClient = await saveSettings(legacy, renamed.version);
    expect(savedByOldClient.value.personalization.name).toBe("交易搭子");
    expect((await readSettings()).value.personalization.name).toBe("交易搭子");
  });
  it("persists trimmed display names through the settings API without calling a model or changing credentials", async () => {
    await configure();
    const old = await readSettings();
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    const response = await aiPOST(new Request("http://localhost/api/ai/settings", {
      method: "PUT", headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ version: old.version, value: { ...old.value, personalization: { name: "  小智 🤖  " } } }),
    }), { params: Promise.resolve({ path: ["settings"] }) });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.value.personalization.name).toBe("小智 🤖");
    expect(JSON.stringify(saved)).not.toContain("private-test-key");
    expect(saved.value.endpoints[0].encryptedKey).toBeUndefined();
    const read = await readSettings();
    expect(read.value.personalization.name).toBe("小智 🤖");
    expect(read.value.endpoints).toEqual(old.value.endpoints);
    expect(read.value.skills).toEqual(old.value.skills);
    await expect(saveSettings(old.value, old.version)).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(mock).not.toHaveBeenCalled();
    await saveSettings({ ...read.value, personalization: { name: copy.ai.title } }, read.version);
    expect((await readSettings()).value.personalization.name).toBe(copy.ai.title);
  });
  it("validates assistant names by Unicode characters and rejects invalid saves without changing persisted settings", async () => {
    expect(personalizationSchema.parse({ name: "🤖".repeat(32) }).name).toHaveLength(64);
    for (const name of ["", "  ", "x".repeat(33), "🤖".repeat(33), "a\nb", "a\tb", "a\u0000b", "a\u2028b"]) {
      expect(personalizationSchema.safeParse({ name }).success).toBe(false);
    }
    await configure();
    const old = await readSettings();
    await expect(saveSettings({ ...old.value, personalization: { name: " " } }, old.version)).rejects.toThrow();
    expect(await readSettings()).toEqual(old);
  });
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
    await expect(generate(endpoint, "test", [], new AbortController().signal)).rejects.toMatchObject({ code: "BUDGET", budget: { resource: "outputTokens", used: 5, limit: 4096 } });
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
      expect(onDetails).toHaveBeenCalledWith({ startedAt: new Date(started).toISOString(), durationMs: 2100, reasoning: "核对所提供的事实。", reasoningMs: 1600, usage: { input: 10, output: 5 }, outputTokenLimit: 4096, finishReason: "stop" });
    } finally { clock.mockRestore(); }
  });
  it("bounds reasoning output and retains partial metadata without accepting reasoning-only or truncated answers", async () => {
    const endpoint = (await readSettings()).value.endpoints[0], onDetails = vi.fn(), onReasoning = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("", "stop", true, "只有思考，没有回答")));
    await expect(generate(endpoint, "test", [], new AbortController().signal, undefined, undefined, { onDetails })).rejects.toMatchObject({ code: "INCOMPLETE" });
    expect(onDetails).toHaveBeenLastCalledWith(expect.objectContaining({ reasoning: "只有思考，没有回答", reasoningMs: expect.any(Number) }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("", "stop", true, "字".repeat(outputCharLimit(DEFAULT_LIMITS) + 1))));
    await expect(generate(endpoint, "test", [], new AbortController().signal, undefined, undefined, { onReasoning })).rejects.toMatchObject({ code: "BUDGET", budget: { resource: "outputChars" } });
    expect(onReasoning).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("字".repeat(32001), "stop", true, "字".repeat(32000))));
    await expect(generate(endpoint, "test", [], new AbortController().signal)).rejects.toMatchObject({ code: "BUDGET", budget: { resource: "outputChars" } });
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
