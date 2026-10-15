import { execFileSync } from "node:child_process";
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
import { saveSettings, readSettings, publicSettings, endpointUrls, protectKey, revealKey } from "./config";
import { createContext, readContext, sessionMetrics } from "./context";
import { createRun, executeRun, cancelRun, recoverRuns, retryRun, validatedResult, resumeRun } from "./runs";
import { generate, sseData } from "./provider";
import { createReplaySession } from "@/lib/replay-sessions/service";
import { PATCH as updateEntry } from "@/app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route";
import { POST as aiPOST, GET as aiGET } from "@/app/api/ai/[...path]/route";
import { type RunInput } from "./schema";
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
function streamResponse(text: string, finish = "stop", done = true) {
  const raw = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] }) + "\n\n"
    + "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + "\n\n" + (done ? "data: [DONE]\n\n" : "");
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(raw)); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}
async function configure() {
  const old = await readSettings(), settings = defaultSettings();
  settings.endpoints = [{ id: "local", name: "Mock", protocol: "chat-completions", baseUrl: "http://localhost:9999/v1", chatUrl: "", modelsUrl: "", defaultModel: "test", models: ["test"], capabilities: {}, apiKey: "private-test-key" }];
  settings.activeEndpointId = "local";
  return saveSettings(settings, old.version);
}
async function makeRun(contextId?: string, task: RunInput["task"] = "globalAssistant") {
  const chat = await prisma.aiConversation.create({ data: { name: "test" } });
  return createRun({ conversationId: chat.id, contextId, task, question: "整理复盘", assetIds: [], chartImages: false, requestId: randomUUID() });
}
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
});
describe("frozen review context and safe adoption", () => {
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(streamResponse("批次事实与来源")).mockResolvedValueOnce(streamResponse(JSON.stringify(answer))));
    await executeRun(run.id);
    const complete = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(complete.status).toBe("COMPLETED"); expect(JSON.parse(complete.checkpoint)).toHaveLength(1);
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
  it("does not charge on missing vision capability or on a forged image scope", async () => {
    const ctx = await createContext({ replaySessionId: sessionId, projectionId, entryId, depth: "quick" });
    const chat = await prisma.aiConversation.create({ data: { name: "vision" } });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const asset = await prisma.aiAsset.create({ data: { id: randomUUID(), mime: "image/png", bytes: 100, contextId: "other", chartHash: "other" } });
    await expect(createRun({ conversationId: chat.id, contextId: ctx.id, task: "reviewDraft", question: "看图", chartImages: false, assetIds: [asset.id], requestId: randomUUID() })).rejects.toMatchObject({ code: "ASSET_SCOPE" });
    const manual = await prisma.aiAsset.create({ data: { id: randomUUID(), mime: "image/png", bytes: 100 } });
    await expect(createRun({ conversationId: chat.id, task: "chartReading", question: "看图", chartImages: false, assetIds: [manual.id], requestId: randomUUID() })).rejects.toMatchObject({ code: "VISION_REQUIRED" });
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
