import { createContext } from "../../lib/ai/context";
import { requestChartImage, listChartCaptures, claimChartCapture, finishChartCapture } from "../../lib/ai/chart-captures";
import { POST as orderPOST } from "../../app/api/market-datasets/[id]/paper-session/orders/route";
import { DELETE as orderDELETE } from "../../app/api/market-datasets/[id]/paper-session/orders/[orderId]/route";
import { defaultSettings } from "../../lib/ai/prompts";
/** Test-only process fixture. Refuses to open a normal application database. */
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db";
import { queueAggregation, processAggregationJob, cancelAggregation } from "../../lib/market-replay/aggregation-jobs";
import { aggregationDispatchCandidate } from "../../lib/market-replay/aggregation-runtime";
import { sqliteWriteTransaction, isSqliteBusy } from "../../lib/sqlite-write";
import { createReplaySession } from "../../lib/replay-sessions/service";
import { loadReplayScope, runWithReplayScope } from "../../lib/replay-sessions/scope";
import { syncReplayToTarget } from "../../lib/market-replay/replay-sync";
import { POST as drawingPOST } from "../../app/api/market-datasets/[id]/drawings/route";
import { PATCH as reviewPATCH } from "../../app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route";
import { PATCH as journalPATCH } from "../../app/api/trade-journals/[id]/route";
import { readSettings, saveSettings } from "../../lib/ai/config";
import { createRun } from "../../lib/ai/runs";

if (!process.env.DATABASE_URL?.includes("aggregation-concurrency-")) throw new Error("Disposable test database required");
let release: (() => void) | undefined;
const send = (message: unknown) => process.send?.(message);
const barrier = () => new Promise<void>((resolve) => { release = resolve; });
const post = (url: string, body: unknown, projectionId?: string) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...(projectionId ? { "X-Replay-Projection": projectionId } : {}) }, body: JSON.stringify(body) });
async function setup() {
  const session = await createReplaySession("a", { name: "concurrent", mode: "LIVE_REPLAY", timestamp: "2026-10-19T22:00:00.000Z", playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
  const journal = await prisma.replayJournalSession.create({ data: { datasetId: "a", replaySessionId: session.id, replayGeneration: 1, initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0 } });
  await prisma.paperTradingSession.create({ data: { id: "account", datasetId: "a", projectionId: session.activeProjectionId, journalSessionId: journal.id, initialCapital: 10000, currency: "USD", lastProcessedSequence: -1, peakEquity: 10000 } });
  const entry = await prisma.replayJournalEntry.create({ data: {
    id: "concurrent-review", journalSessionId: journal.id, projectionId: session.activeProjectionId, logicalKey: "review", no: 1, lotId: "test-lot", direction: "LONG", quantity: 1,
    openedSequence: 0, closedSequence: 0, openedAt: new Date("2026-10-19T22:00:00Z"), closedAt: new Date("2026-10-19T22:00:00Z"), entryPrice: 100, exitPrice: 101,
    abrLength: 8, displayIntervalSeconds: 60, displaySession: "ETH", displayUtcOffsetMinutes: 0, priceTickSize: 0.25, initialRisk: 1, actualRisk: 1, gainLoss: 1,
  } });
  await prisma.tradeDataset.create({ data: { id: "journal-dataset", name: "journal", tradeJournal: { create: { id: "journal", name: "journal" } } } });
  await prisma.aiConversation.create({ data: { id: "chat", name: "chat" } });
  const settings = defaultSettings();
  settings.endpoints = [{ id: "local", name: "test", protocol: "chat-completions", baseUrl: "http://localhost:9999/v1", chatUrl: "", modelsUrl: "", defaultModel: "test", models: ["test"], capabilities: {} }];
  settings.activeEndpointId = "local";
  await saveSettings(settings, (await readSettings()).version);
  return { sessionId: session.id, entryId: entry.id };
}
async function foreground(sessionId: string, entryId: string, index: number) {
  const times: number[] = [];
  async function measure(work: () => Promise<unknown>) { const start = performance.now(); const result = await work(); times.push(performance.now() - start); return result; }
  let scope = await loadReplayScope(sessionId);
  const drawing = await measure(() => drawingPOST(post(`http://localhost/drawings?replaySessionId=${sessionId}`, { type: "TEXT", clientId: randomUUID(), geometry: { anchor: { timestamp: "2026-10-19T22:00:00.000Z", sourceSequence: 0, price: 100 }, text: "saved-" + index } }, scope.projectionId), { params: Promise.resolve({ id: "a" }) })) as Response;
  if (!drawing.ok) throw new Error("drawing: " + await drawing.text());
  const review = await measure(() => reviewPATCH(new Request(`http://localhost/review?replaySessionId=${sessionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review: "review-" + index }) }), { params: Promise.resolve({ id: "a", entryId }) })) as Response;
  if (!review.ok) throw new Error("review: " + await review.text());
  const journal = await measure(() => journalPATCH(new Request("http://localhost/journal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "journal-" + index, description: "saved" }) }), { params: Promise.resolve({ id: "journal" }) })) as Response;
  if (!journal.ok) throw new Error("journal: " + await journal.text());
  const progress = await prisma.replayProgress.findFirstOrThrow({ where: { replaySessionId: sessionId } });
  if (progress.currentSequence >= 0) {
    const account = await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: "account" } });
    const placed = await measure(() => orderPOST(post(`http://localhost/orders?replaySessionId=${sessionId}`, { side: "BUY", type: "LIMIT", quantity: 1, price: 10, expectedVersion: account.version }, scope.projectionId), { params: Promise.resolve({ id: "a" }) })) as Response;
    if (!placed.ok) throw new Error("order: " + await placed.text());
    const order = await prisma.paperOrder.findFirstOrThrow({ where: { sessionId: account.id, status: "PENDING" } });
    scope = await loadReplayScope(sessionId);
    const changed = await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: "account" } });
    const cancelled = await measure(() => orderDELETE(new Request(`http://localhost/orders?replaySessionId=${sessionId}`, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Replay-Projection": scope.projectionId }, body: JSON.stringify({ expectedVersion: changed.version }) }), { params: Promise.resolve({ id: "a", orderId: order.id }) })) as Response;
    if (!cancelled.ok) throw new Error("cancel: " + await cancelled.text());
    scope = await loadReplayScope(sessionId);
  }
  const account = await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: "account" } });
  const advance = await measure(() => runWithReplayScope(scope, () => syncReplayToTarget("a", { generation: progress.generation, requestId: "advance-" + index, confirmedSequence: progress.currentSequence, syncVersion: progress.syncVersion, expectedPaperVersion: account.version, targetSequence: progress.currentSequence + 1 })));
  if ((advance as { status: number }).status !== 200) throw new Error("advance: " + JSON.stringify(advance));
  return times;
}
process.on("message", (message: { id: number; command: string; jobId?: string; queueToken?: string | null; datasetId?: string; pause?: boolean; waitForStart?: boolean; sessionId?: string; entryId?: string; index?: number; retry?: boolean; taskId?: string; lease?: string; heartbeat?: boolean }) => {
  if (message.command === "release") { const resume = release; release = undefined; resume?.(); return; }
  void (async () => {
    switch (message.command) {
      case "setup": return setup();
      case "queue": return queueAggregation(message.datasetId!);
      case "cancel": return cancelAggregation(message.datasetId!);
      case "candidate": return aggregationDispatchCandidate();
      case "run": {
        if (message.waitForStart) { const waiting = barrier(); send({ event: "ready-run", id: message.id }); await waiting; }
        let paused = false;
        return processAggregationJob(message.jobId!, { afterBatch: async () => {
          if (message.pause && !paused) { paused = true; const waiting = barrier(); send({ event: "batch", id: message.id }); await waiting; }
        } }, message.queueToken);
      }
      case "foreground": return foreground(message.sessionId!, message.entryId!, message.index!);
      case "ai": return createRun({ requestId: "ai-" + message.index, conversationId: "chat", task: "globalAssistant", question: "test", assetIds: [], chartImages: false });
      case "capture": {
        const scope = await loadReplayScope(message.sessionId!);
        const context = await createContext({ replaySessionId: scope.id, projectionId: scope.projectionId, entryId: message.entryId, depth: "quick", timeframes: ["1m"] });
        const chart = context.charts[0];
        if (!chart) throw new Error("Missing frozen source-period chart");
        await prisma.aiConversation.create({ data: { id: "capture-chat", name: "capture" } });
        const run = await createRun({ requestId: randomUUID(), conversationId: "capture-chat", contextId: context.id, task: "globalAssistant", question: "chart", assetIds: [], chartImages: false });
        await prisma.aiRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
        const variantId = randomUUID();
        await prisma.aiChartVariant.create({ data: { id: variantId, contextId: context.id, value: JSON.stringify(chart) } });
        return requestChartImage(run.id, context.id, variantId, chart, new AbortController().signal, () => {
          void listChartCaptures([run.id]).then((tasks) => send({ event: "capture", id: message.id, taskId: tasks[0]?.id }));
        });
      }
      case "capture-claim": return claimChartCapture(message.taskId!);
      case "capture-finish": return finishChartCapture(message.taskId!, message.lease!, message.heartbeat ? { heartbeat: true } : { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=" });
      case "snapshot": {
        let attempts = 0;
        const work = async (tx: Parameters<Parameters<typeof sqliteWriteTransaction>[1]>[0]) => {
          attempts++;
          await tx.marketDataset.findUniqueOrThrow({ where: { id: "a" } });
          if (attempts === 1) { const waiting = barrier(); send({ event: "read", id: message.id }); await waiting; }
          await tx.tradeDataset.update({ where: { id: "journal-dataset" }, data: { name: "snapshot-result" } });
        };
        if (message.retry) { await sqliteWriteTransaction(prisma, work, { writeFence: false }); return { attempts }; }
        try { await prisma.$transaction(work); } catch (error) { return { busy: isSqliteBusy(error) }; }
        return { busy: false };
      }
      case "checkpoint": return sqliteWriteTransaction(prisma, async (tx) => { await tx.tradeDataset.update({ where: { id: "journal-dataset" }, data: { name: "other-writer" } }); });
      case "hold": return prisma.$transaction(async (tx) => { await tx.tradeDataset.update({ where: { id: "journal-dataset" }, data: { name: "held" } }); const waiting = barrier(); send({ event: "held", id: message.id }); await waiting; });
      case "close": await prisma.$disconnect(); setImmediate(() => process.exit(0)); return;
      default: throw new Error("Unknown fixture command");
    }
  })().then((result) => send({ id: message.id, result })).catch((error) => send({ id: message.id, error: error.stack ?? String(error) }));
});
send({ event: "ready" });
