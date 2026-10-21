import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import JSZip from "jszip";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return {
    prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), `replay-sessions-${randomUUID()}.db`)}` }, { allowCreate: true }),
    replayDatabaseQueryCount: () => null,
  };
});

import { prisma } from "@/lib/db";
import { createReplaySession } from "./service";
import { loadReplayScope, runWithReplayScope } from "./scope";
import { GET as progressGET } from "@/app/api/market-datasets/[id]/progress/route";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { POST as orderPOST } from "@/app/api/market-datasets/[id]/paper-session/orders/route";
import { DELETE as entryDELETE, PATCH as entryPATCH } from "@/app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route";
import { POST as advancePOST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { POST as drawingPOST, GET as drawingsGET, DELETE as drawingsDELETE } from "@/app/api/market-datasets/[id]/drawings/route";
import { PATCH as drawingPATCH, DELETE as drawingDELETE } from "@/app/api/market-datasets/[id]/drawings/[drawingId]/route";
import { DELETE as sessionDELETE, GET as sessionGET, PATCH as sessionPATCH } from "@/app/api/replay-sessions/[sessionId]/route";
import { DELETE as journalSessionDELETE } from "@/app/api/market-datasets/[id]/paper-journal/sessions/[sessionId]/route";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { DEFAULT_TREND_LINE_STYLE, DEFAULT_RECTANGLE_STYLE, DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_TEXT_STYLE } from "@/lib/market-replay/chart-drawings";
import { createCorrection, commitCorrection, cancelCorrection, readCorrection } from "./corrections";
import { runReplayCorrection } from "./correction-runner";
import { GET as journalGET } from "@/app/api/market-datasets/[id]/paper-journal/route";
import { GET as pdfSnapshotGET } from "@/app/api/market-datasets/[id]/paper-journal/sessions/[sessionId]/export-data/route";
import { GET as locateGET } from "@/app/api/replay-sessions/[sessionId]/locate/route";
import { startReplayCorrectionWorker } from "./worker";
import { PATCH as amendOrderPATCH } from "@/app/api/market-datasets/[id]/paper-session/orders/[orderId]/route";
import { DELETE as cancelOrderDELETE } from "@/app/api/market-datasets/[id]/paper-session/orders/[orderId]/route";
import { GET as sessionsGET } from "@/app/api/market-datasets/[id]/replay-sessions/route";
import { GET as excelGET } from "@/app/api/market-datasets/[id]/paper-journal/sessions/[sessionId]/export/route";
import { aggregateMarketBars } from "@/lib/market-replay/aggregation";
import { chartRewindTarget } from "@/lib/market-replay/chart-rewind";
import { formatUtcDateTime } from "@/lib/market-replay/display-timezone";
import { GET as annotationsGET } from "@/app/api/market-datasets/[id]/paper-journal/annotations/route";
import { replayJournalLinkTarget, replayJournalTradeHref } from "@/lib/paper-trading/journal-links";

let file = "";
const base = new Date("2026-10-01T00:00:00Z");
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: {
    id: "shared", name: "Shared", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60,
    barCount: 8, startTime: base, endTime: new Date(base.getTime() + 420_000),
  } });
  await prisma.marketBar.createMany({ data: Array.from({ length: 8 }, (_, sequence) => ({
    datasetId: "shared", sequence, timestamp: new Date(base.getTime() + sequence * 60_000),
    open: 100 + sequence, high: 102 + sequence, low: 99 + sequence, close: 101 + sequence,
  })) });
}, 30_000);
afterAll(async () => {
  await prisma.$disconnect();
  if (file.includes("replay-sessions-")) rmSync(file, { force: true });
});

async function create(mode: "TRAINING" | "LIVE_REPLAY") {
  return createReplaySession("shared", { name: mode, mode, timestamp: base.toISOString(), playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
}
const context = { params: Promise.resolve({ id: "shared" }) };
function request(session: { id: string; activeProjectionId: string | null }, method: string, body?: unknown, query = "") {
  return new Request(`http://localhost/api/test?replaySessionId=${encodeURIComponent(session.id)}${query}`, {
    method, headers: { "Content-Type": "application/json", "X-Replay-Projection": session.activeProjectionId! },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("session drawing persistence", () => {
  const geometry = { start: { timestamp: base.toISOString(), sourceSequence: 0, price: 100 },
    end: { timestamp: new Date(base.getTime() + 60_000).toISOString(), sourceSequence: 1, price: 101 } };
  const itemContext = (id: string) => ({ params: Promise.resolve({ id: "shared", drawingId: id }) });
  async function archive(session: Awaited<ReturnType<typeof create>>) {
    const response = await sessionPATCH(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: (await loadReplayScope(session.id)).version, status: "ARCHIVED" }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(response.status).toBe(200);
  }
  async function read(session: Awaited<ReturnType<typeof create>>) { return (await drawingsGET(request(session, "GET"), context)).json(); }
  it.each([
    { type: "TREND_LINE", style: DEFAULT_TREND_LINE_STYLE },
    { type: "RECTANGLE", style: DEFAULT_RECTANGLE_STYLE },
    { type: "FIB_RETRACEMENT", style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE },
    { type: "TEXT", style: DEFAULT_TEXT_STYLE },
  ].flatMap(drawing => (["ACTIVE", "ARCHIVED"] as const).map(status => ({ ...drawing, status }))))("retains and edits $status $type drawings without changing trading records", async ({ type, style, status }) => {
    const session = await create("LIVE_REPLAY"), sibling = await create("TRAINING");
    const shape = type === "TEXT" ? { anchor: geometry.start, text: "测试文字\n多行" } : geometry;
    expect((await accountPOST(request(session, "POST", { initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0 }), context)).status).toBe(201);
    const beforeArchive = await drawingPOST(request(session, "POST", { type, style, geometry: shape }), context);
    expect(beforeArchive.status).toBe(201);
    const original = (await beforeArchive.json()).drawing;
    if (status === "ARCHIVED") await archive(session);
    const frozen = await prisma.replaySession.findUnique({ where: { id: session.id }, include: {
      progress: true, commands: true, journal: { include: { entries: true } }, projections: { include: { account: { include: { orders: true, fills: true, equityPoints: true } } } },
    } });
    expect((await read(session)).drawings.map((item: { id: string }) => item.id)).toEqual([original.id]);
    const created = await drawingPOST(request(session, "POST", { type, style, geometry: shape }), context);
    expect(created.status).toBe(201);
    const nextGeometry = type === "TEXT" ? { anchor: { ...geometry.start, price: 103 }, text: "更新文字" }
      : { ...geometry, end: { ...geometry.end, price: 103 } };
    expect((await drawingPATCH(request(session, "PATCH", { geometry: nextGeometry }), itemContext(original.id))).status).toBe(200);
    expect((await read(session)).drawings.find((item: { id: string }) => item.id === original.id).geometry).toEqual(nextGeometry);
    if (type === "FIB_RETRACEMENT") {
      const displayStyle = { ...DEFAULT_FIBONACCI_RETRACEMENT_STYLE, singleColor: "#123456", showPrices: false, showLevels: false };
      expect((await drawingPATCH(request(session, "PATCH", { style: displayStyle }), itemContext(original.id))).status).toBe(200);
      expect((await read(session)).drawings.find((item: { id: string }) => item.id === original.id).style).toEqual(displayStyle);
      expect(JSON.parse((await prisma.marketDrawing.findUniqueOrThrow({ where: { id: original.id } })).style)).toEqual(displayStyle);
    }
    if (type === "TEXT") {
      const nextStyle = { ...DEFAULT_TEXT_STYLE, bold: true, backgroundEnabled: true, wrapEnabled: true, wrapWidth: 200 };
      expect((await drawingPATCH(request(session, "PATCH", { geometry: nextGeometry, style: nextStyle }), itemContext(original.id))).status).toBe(200);
      expect((await read(session)).drawings.find((item: { id: string }) => item.id === original.id)).toMatchObject({ geometry: nextGeometry, style: nextStyle });
      expect((await drawingPATCH(request(session, "PATCH", { geometry }), itemContext(original.id))).status).toBe(400);
      expect((await drawingPATCH(request(session, "PATCH", { style: DEFAULT_TREND_LINE_STYLE }), itemContext(original.id))).status).toBe(400);
    }
    expect((await drawingDELETE(request(session, "DELETE"), itemContext(original.id))).status).toBe(200);
    expect((await read(session)).drawings.map((item: { id: string }) => item.id)).not.toContain(original.id);
    expect((await read(sibling)).drawings).toEqual([]);
    if (status === "ARCHIVED") {
      expect((await advancePOST(request(session, "POST", { count: 1, expectedCurrentSequence: -1, expectedVersion: 1 }), context)).status).toBe(409);
      expect((await orderPOST(request(session, "POST", { side: "BUY", type: "MARKET", quantity: 1, price: null, expectedVersion: 1 }), context)).status).toBe(409);
    }
    expect(await prisma.replaySession.findUnique({ where: { id: session.id }, include: {
      progress: true, commands: true, journal: { include: { entries: true } }, projections: { include: { account: { include: { orders: true, fills: true, equityPoints: true } } } },
    } })).toEqual(frozen);
  });
  it("isolates individual deletion and clear, retaining unseen concurrent objects and sibling sessions", async () => {
    const a = await create("TRAINING"), b = await create("TRAINING");
    const add = async (session: typeof a) => (await (await drawingPOST(request(session, "POST", { type: "RECTANGLE", style: DEFAULT_RECTANGLE_STYLE, geometry }), context)).json()).drawing;
    const first = await add(a), foreign = await add(b); await archive(a); await archive(b);
    expect((await drawingDELETE(request(a, "DELETE"), itemContext(foreign.id))).status).toBe(404);
    expect((await drawingPATCH(request(a, "PATCH", { geometry }), itemContext(foreign.id))).status).toBe(404);
    const concurrent = await add(a);
    expect((await drawingsDELETE(request(a, "DELETE", { ids: [first.id, foreign.id] }), context)).status).toBe(200);
    expect((await read(a)).drawings.map((item: { id: string }) => item.id)).toEqual([concurrent.id]);
    expect((await read(b)).drawings.map((item: { id: string }) => item.id)).toEqual([foreign.id]);
    expect((await drawingPOST(request({ ...a, activeProjectionId: "old" }, "POST", { type: "RECTANGLE", geometry }), context)).status).toBe(409);
  });

});

describe("multiple replay sessions on shared market data", () => {
  it("requires explicit identity and isolates progress, accounts, commands and drawings", async () => {
    const a = await create("TRAINING");
    const b = await create("LIVE_REPLAY");
    expect((await progressGET(new Request("http://localhost/api/test"), context)).status).toBe(409);
    for (const session of [a, b]) {
      expect((await accountPOST(request(session, "POST", { initialCapital: session === a ? 10_000 : 20_000, currency: "USD", commissionBps: 0, slippageBps: 0 }), context)).status).toBe(201);
    }
    const first = await advancePOST(request(a, "POST", { count: 1, expectedCurrentSequence: -1, expectedVersion: 1 }), context);
    expect(first.status).toBe(200);
    const state = await first.json();
    expect(state.currentSequence).toBe(0);
    expect((await (await progressGET(request(b, "GET"), context)).json()).progress.currentSequence).toBe(-1);
    expect(state.snapshot.session.initialCapital).toBe(10_000);

    const placed = await orderPOST(request(a, "POST", { side: "BUY", type: "MARKET", quantity: 1, price: null, expectedVersion: state.snapshot.session.version }), context);
    expect(placed.status).toBe(201);
    const placedState = await placed.json();
    expect((await advancePOST(request(a, "POST", { count: 1, expectedCurrentSequence: 0, expectedVersion: placedState.snapshot.session.version }), context)).status).toBe(200);
    expect(await prisma.paperFill.count({ where: { session: { projectionId: a.activeProjectionId } } })).toBe(1);
    expect(await prisma.paperFill.count({ where: { session: { projectionId: b.activeProjectionId } } })).toBe(0);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: a.id, type: "ORDER_CREATE" } })).toBe(1);
    const bScope = await loadReplayScope(b.id);
    const bSnapshot = await runWithReplayScope(bScope, () => getPaperSessionSnapshot("shared"));
    expect(bSnapshot?.session.netQuantity).toBe(0);
    expect(bSnapshot?.session.initialCapital).toBe(20_000);

    const drawing = { type: "TREND_LINE", geometry: { start: { timestamp: base.toISOString(), sourceSequence: 0, price: 100 }, end: { timestamp: new Date(base.getTime() + 60_000).toISOString(), sourceSequence: 1, price: 101 } }, style: DEFAULT_TREND_LINE_STYLE };
    const drawResponse = await drawingPOST(request(a, "POST", drawing), context);
    // The real drawing schema is deliberately used; assertions below verify ownership.
    if (drawResponse.status !== 201) throw new Error(JSON.stringify(await drawResponse.json()));
    expect((await (await drawingsGET(request(a, "GET"), context)).json()).drawings).toHaveLength(1);
    expect((await (await drawingsGET(request(b, "GET"), context)).json()).drawings).toHaveLength(0);
    expect(await prisma.marketBar.count({ where: { datasetId: "shared" } })).toBe(8);
  });

  it("retains archived state, prohibits training deletion and rejects old projections", async () => {
    const session = await create("TRAINING");
    const scope = await loadReplayScope(session.id);
    const archived = await sessionPATCH(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, status: "ARCHIVED" }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(archived.status).toBe(200);
    expect(await prisma.replayProgress.findUnique({ where: { replaySessionId: session.id } })).not.toBeNull();
    const blocked = await entryDELETE(request(session, "DELETE"), { params: Promise.resolve({ id: "shared", entryId: "any-entry" }) });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe("MODE_NOT_ALLOWED");
    const other = await create("LIVE_REPLAY");
    const stale = await accountPOST(request({ ...other, activeProjectionId: "old-projection" }, "POST", { initialCapital: 1000, currency: "USD" }), context);
    expect(stale.status).toBe(409);
    expect(await prisma.paperTradingSession.count({ where: { projectionId: other.activeProjectionId } })).toBe(0);
  });
  it("keeps mode immutable and rejects a session belonging to another dataset", async () => {
    const session = await create("TRAINING");
    const changed = await sessionPATCH(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: session.version, mode: "LIVE_REPLAY" }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(changed.status).toBe(400);
    expect((await loadReplayScope(session.id)).mode).toBe("TRAINING");
    const wrongDataset = await progressGET(request(session, "GET"), { params: Promise.resolve({ id: "other-dataset" }) });
    expect(wrongDataset.status).toBe(404);
    await expect(createCorrection(session.id, { requestId: "training-rewind", type: "REWIND", targetSequence: -1, expectedVersion: session.version })).rejects.toMatchObject({ code: "MODE_NOT_ALLOWED" });
  });
});

describe("complete replay corrections", () => {
  async function account(session: Awaited<ReturnType<typeof create>>) {
    const response = await accountPOST(request(session, "POST", { initialCapital: 10_000, currency: "USD", commissionBps: 10, slippageBps: 20 }), context);
    expect(response.status).toBe(201);
  }
  async function snapshot(sessionId: string) {
    return runWithReplayScope(await loadReplayScope(sessionId), () => getPaperSessionSnapshot("shared"));
  }
  async function advance(session: Awaited<ReturnType<typeof create>>, count = 1) {
    const state = await snapshot(session.id);
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const response = await advancePOST(request(session, "POST", { count, expectedCurrentSequence: progress.currentSequence, expectedVersion: state!.session.version }), context);
    if (response.status !== 200) throw new Error(JSON.stringify(await response.json()));
    return snapshot(session.id);
  }
  async function order(session: Awaited<ReturnType<typeof create>>, side: "BUY" | "SELL", quantity: number, reduceOnly = false) {
    const state = await snapshot(session.id);
    const response = await orderPOST(request(session, "POST", { side, type: "MARKET", price: null, quantity, reduceOnly, expectedVersion: state!.session.version }), context);
    expect(response.status).toBe(201);
  }
  function remove(sessionId: string, body: unknown) {
    return sessionDELETE(new Request("http://localhost/api/session", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ sessionId }) });
  }
  async function exportedNumbers(session: Awaited<ReturnType<typeof create>>, journalId: string) {
    const routeContext = { params: Promise.resolve({ id: "shared", sessionId: journalId }) };
    const pdf = await pdfSnapshotGET(request(session, "GET"), routeContext);
    expect(pdf.status).toBe(200);
    const excel = await excelGET(request(session, "GET"), routeContext);
    expect(excel.status).toBe(200);
    const zip = await JSZip.loadAsync(await excel.arrayBuffer());
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const numbers = Array.from(sheet.matchAll(/<c r="A(\d+)"[^>]*><v>(\d+)<\/v><\/c>/g)).map((match) => Number(match[2]));
    return { pdf: await pdf.json(), excel: numbers };
  }
  it.each(["TRAINING", "LIVE_REPLAY"] as const)("immediately closes a paused %s position and persists the whole result at the same sequence", async (mode) => {
    const session = await create(mode); await account(session); await advance(session);
    const side = mode === "TRAINING" ? "BUY" : "SELL";
    let state = (await snapshot(session.id))!;
    const entry = await orderPOST(request(session, "POST", { side, type: "MARKET", quantity: 2,
      stopLoss: side === "BUY" ? 50 : 150, takeProfit: side === "BUY" ? 150 : 50, expectedVersion: state.session.version }), context);
    expect(entry.status).toBe(201);
    await advance(session);
    state = (await snapshot(session.id))!;
    const pending = await orderPOST(request(session, "POST", { side: "BUY", type: "LIMIT", quantity: 1, price: 40, expectedVersion: state.session.version }), context);
    expect(pending.status).toBe(201);
    state = (await snapshot(session.id))!;
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const unrelated = await create("TRAINING"); await account(unrelated);
    const unrelatedBefore = await snapshot(unrelated.id);
    const payload = { side: side === "BUY" ? "SELL" : "BUY", type: "MARKET", quantity: 2, reduceOnly: true,
      executeAtCurrentClose: true, expectedVersion: state.session.version };
    const response = await orderPOST(request(session, "POST", payload), context);
    expect(response.status).toBe(201);
    const closed = (await response.json()).snapshot;
    const price = 102 * (side === "BUY" ? 0.998 : 1.002);
    expect(closed.session).toMatchObject({ netQuantity: 0, averageEntryPrice: null, lastProcessedSequence: 1, version: state.session.version + 1 });
    expect(closed.recentFills).toHaveLength(2);
    expect(closed.recentFills[0]).toMatchObject({ sequence: 1, timestamp: new Date(base.getTime() + 60_000).toISOString(),
      price, reason: "CLOSE", quantity: 2, openedQuantity: 0 });
    expect(closed.activeOrders).toHaveLength(1);
    expect(closed.activeOrders[0]).toMatchObject({ price: 40, status: "PENDING", isProtective: false });
    expect(closed.recentOrders.filter((item: { isProtective: boolean; status: string }) => item.isProtective && item.status === "CANCELLED")).toHaveLength(2);
    expect(closed.stats).toMatchObject({ tradeCount: 1, journalEntryCount: 1, unrealizedPnl: 0 });
    expect(closed.stats.totalFees).toBeCloseTo((101 * (side === "BUY" ? 1.002 : 0.998) + price) * 2 / 1000);
    const storedAccount = await prisma.paperTradingSession.findUniqueOrThrow({ where: { projectionId: session.activeProjectionId } });
    const point = await prisma.paperEquityPoint.findUniqueOrThrow({ where: { sessionId_sequence: { sessionId: storedAccount.id, sequence: 1 } } });
    expect(point.equity).toBeCloseTo(closed.stats.equity);
    const journal = await prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: session.activeProjectionId } });
    expect(journal).toMatchObject({ openedSequence: 1, closedSequence: 1, quantity: 2, exitPrice: price });
    expect(await prisma.replayProgress.findUnique({ where: { replaySessionId: session.id } })).toEqual(progress);
    expect(await snapshot(unrelated.id)).toEqual(unrelatedBefore);
    expect((await orderPOST(request(session, "POST", payload), context)).status).toBe(409);
    expect((await orderPOST(request(session, "POST", { ...payload, expectedVersion: closed.session.version }), context)).status).toBe(400);
    expect(await prisma.paperFill.count({ where: { sessionId: storedAccount.id } })).toBe(2);
    const afterNext = (await advance(session))!;
    expect(afterNext.session.netQuantity).toBe(0);
    expect(afterNext.recentFills).toHaveLength(2);
    expect(afterNext.stats.tradeCount).toBe(1);
  });

  it("rolls back the order, account and journals if immediate fill persistence fails", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    const before = (await snapshot(session.id))!;
    const commands = await prisma.replayCommand.count({ where: { replaySessionId: session.id } });
    const point = await prisma.paperEquityPoint.findFirstOrThrow({ where: { session: { projectionId: session.activeProjectionId }, sequence: 1 } });
    await prisma.$executeRawUnsafe("CREATE TRIGGER reject_current_close BEFORE INSERT ON PaperFill WHEN NEW.reason = 'CLOSE' BEGIN SELECT RAISE(ABORT, 'test current close failure'); END");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await orderPOST(request(session, "POST", { side: "SELL", type: "MARKET", quantity: 1, reduceOnly: true,
        executeAtCurrentClose: true, expectedVersion: before.session.version }), context);
      expect(response.status).toBe(500);
      expect(await snapshot(session.id)).toEqual(before);
      expect(await prisma.replayCommand.count({ where: { replaySessionId: session.id } })).toBe(commands);
      expect(await prisma.paperEquityPoint.findFirstOrThrow({ where: { session: { projectionId: session.activeProjectionId }, sequence: 1 } })).toEqual(point);
    } finally {
      log.mockRestore();
      await prisma.$executeRawUnsafe("DROP TRIGGER reject_current_close");
    }
  });

  it("allows immediate close on the last source bar while ordinary market closes still need a next bar", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session, 7);
    const state = (await snapshot(session.id))!;
    expect(state.session.lastProcessedSequence).toBe(7);
    const payload = { side: "SELL", type: "MARKET", quantity: 1, reduceOnly: true, expectedVersion: state.session.version };
    expect((await orderPOST(request(session, "POST", payload), context)).status).toBe(400);
    const response = await orderPOST(request(session, "POST", { ...payload, executeAtCurrentClose: true }), context);
    expect(response.status).toBe(201);
    expect((await response.json()).snapshot.recentFills[0]).toMatchObject({ sequence: 7, price: 108 * 0.998, reason: "CLOSE" });
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
  });

  it("rewinds to the candle before its immediate-close command, restoring the position without leaked fills or journals", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    const state = (await snapshot(session.id))!;
    expect((await orderPOST(request(session, "POST", { side: "SELL", type: "MARKET", quantity: 1, reduceOnly: true,
      executeAtCurrentClose: true, expectedVersion: state.session.version }), context)).status).toBe(201);
    const job = await createCorrection(session.id, { requestId: "rewind-immediate-close", type: "REWIND", targetSequence: 1,
      expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id);
    expect((await readCorrection(session.id, job.id)).status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const restored = (await snapshot(session.id))!;
    expect(restored.session.netQuantity).toBe(1);
    expect(restored.session.lastProcessedSequence).toBe(1);
    expect(restored.recentFills).toHaveLength(1);
    expect(restored.recentFills[0].reason).toBe("ENTRY");
    expect(restored.stats).toMatchObject({ tradeCount: 0, journalEntryCount: 0 });
    expect(restored.recentTrades).toHaveLength(1);
    expect(restored.recentTrades[0].status).toBe("OPEN");
  });

  it("rebuilds a retained immediate close when deleting an earlier position cycle", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    let state = (await snapshot(session.id))!;
    const firstCycle = state.recentFills[0].cycleKey!;
    async function closeNow() {
      state = (await snapshot(session.id))!;
      const response = await orderPOST(request(session, "POST", { side: "SELL", type: "MARKET", quantity: 1, reduceOnly: true,
        executeAtCurrentClose: true, expectedVersion: state.session.version }), context);
      expect(response.status).toBe(201);
    }
    await closeNow();
    await order(session, "BUY", 1); await advance(session);
    await closeNow();
    const retained = (await snapshot(session.id))!.recentFills[0];
    await advance(session, 2);
    const job = await createCorrection(session.id, { requestId: "delete-before-immediate-close", type: "DELETE_CYCLE", cycleKey: firstCycle,
      expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id);
    expect((await readCorrection(session.id, job.id)).status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const rebuilt = (await snapshot(session.id))!;
    expect(rebuilt.session).toMatchObject({ netQuantity: 0, lastProcessedSequence: 4 });
    expect(rebuilt.recentFills).toHaveLength(2);
    expect(rebuilt.recentFills[0]).toEqual(retained);
    expect(rebuilt.stats).toMatchObject({ tradeCount: 1, journalEntryCount: 1 });
  });

  it("displays the sixth allocated trade as 1 after repeated rewinds, then continues at 2 without changing internal identity", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    for (let attempt = 0; attempt < 5; attempt++) {
      await order(session, "BUY", 1); await advance(session);
      await order(session, "SELL", 1, true); await advance(session);
      const job = await createCorrection(session.id, { requestId: `number-rewind-${attempt}`, type: "REWIND", targetSequence: 0,
        expectedVersion: (await loadReplayScope(session.id)).version });
      await runReplayCorrection(job.id); await commitCorrection(session.id, job.id);
      session.activeProjectionId = (await loadReplayScope(session.id)).projectionId;
    }
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const entry = await prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: session.activeProjectionId } });
    expect(entry.accountNo).toBe(6);
    const before = await snapshot(session.id);
    const journal = await (await journalGET(request(session, "GET"), context)).json();
    expect(journal.items).toMatchObject([{ id: entry.id, no: 1, globalNo: entry.no }]);
    expect((await (await annotationsGET(request(session, "GET", undefined, "&fromSequence=0&toSequence=7"), context)).json()).items)
      .toMatchObject([{ id: entry.id, no: 1 }]);
    const exported = await exportedNumbers(session, entry.journalSessionId);
    expect(exported.pdf.entries.map((item: { no: number }) => item.no)).toEqual([1]);
    expect(exported.excel).toEqual([1]);
    expect(await snapshot(session.id)).toEqual(before);
    expect(await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entry.id } })).toEqual(entry);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    expect((await (await journalGET(request(session, "GET"), context)).json()).items.map((item: { no: number }) => item.no)).toEqual([1, 2]);
  });
  it("keeps session-wide numbering across pagination, filtering, chart windows, edits, exports and legacy/new links", async () => {
    const session = await create("TRAINING"); await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const original = await prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: session.activeProjectionId } });
    await prisma.replayJournalEntry.update({ where: { id: original.id }, data: { accountNo: 2 } });
    // Seed a gapped persisted journal in this isolated database, representing surviving records.
    const counter = await prisma.marketDataset.update({ where: { id: "shared" }, data: { nextReplayJournalNo: { increment: 11 } }, select: { nextReplayJournalNo: true } });
    await prisma.replayJournalEntry.createMany({ data: Array.from({ length: 11 }, (_, index) => {
      const ordinal = index + 2, openedSequence = ordinal === 12 ? 5 : 3, closedSequence = ordinal === 12 ? 6 : 4;
      return { ...original, id: `${session.id}-number-${ordinal}`, logicalKey: `${session.id}-logical-${ordinal}`, accountNo: ordinal * 2,
        no: counter.nextReplayJournalNo - 10 + index, direction: ordinal % 2 ? "LONG" : "SHORT", openedSequence, closedSequence,
        openedAt: new Date(base.getTime() + openedSequence * 60_000), closedAt: new Date(base.getTime() + closedSequence * 60_000) };
    }) });
    const stored = await prisma.replayJournalEntry.findMany({ where: { projectionId: session.activeProjectionId }, orderBy: { accountNo: "asc" } });
    const accountBefore = await snapshot(session.id);
    expect((await (await journalGET(request(session, "GET", undefined, "&page=2&take=10"), context)).json()).items.map((item: { no: number }) => item.no)).toEqual([11, 12]);
    expect((await (await journalGET(request(session, "GET", undefined, "&directions=SHORT"), context)).json()).items.map((item: { no: number }) => item.no)).toEqual([2, 4, 6, 8, 10, 12]);
    expect((await (await annotationsGET(request(session, "GET", undefined, "&fromSequence=5&toSequence=6"), context)).json()).items.map((item: { no: number }) => item.no)).toEqual([12]);
    const exported = await exportedNumbers(session, original.journalSessionId);
    expect(exported.pdf.entries.map((item: { no: number }) => item.no)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(exported.excel).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    const filteredPdf = await (await pdfSnapshotGET(request(session, "GET", undefined, "&directions=SHORT"), { params: Promise.resolve({ id: "shared", sessionId: original.journalSessionId }) })).json();
    expect(filteredPdf.entries.map((item: { no: number }) => item.no)).toEqual([2, 4, 6, 8, 10, 12]);
    expect(await snapshot(session.id)).toEqual(accountBefore);
    expect(await prisma.replayJournalEntry.findMany({ where: { projectionId: session.activeProjectionId }, orderBy: { accountNo: "asc" } })).toEqual(stored);
    const last = stored.at(-1)!;
    const edited = await entryPATCH(request(session, "PATCH", { review: "第十二笔复盘" }), { params: Promise.resolve({ id: "shared", entryId: last.id }) });
    expect(edited.status).toBe(200); expect(await edited.json()).toMatchObject({ id: last.id, no: 12, globalNo: last.no, review: "第十二笔复盘" });
    const focused = await annotationsGET(request(session, "GET", undefined, `&journalNo=${last.no}`), context);
    expect((await focused.json()).items).toMatchObject([{ id: last.id, no: 12 }]);
    const href = replayJournalTradeHref("shared", last.journalSessionId, last.no);
    const stableTarget = replayJournalLinkTarget({ journalNo: new URL(href, "http://localhost").searchParams.get("journalNo")! });
    const parent = { journalSessionId: last.journalSessionId, projectionId: session.activeProjectionId };
    expect((await prisma.replayJournalEntry.findFirstOrThrow({ where: { ...parent, ...stableTarget! } })).id).toBe(last.id);
    expect((await prisma.replayJournalEntry.findFirstOrThrow({ where: { ...parent, ...replayJournalLinkTarget({ trade: "24" })! } })).id).toBe(last.id);
    // An old bookmark to deleted stored No 1 never opens the newly displayed No 1.
    expect(await prisma.replayJournalEntry.findFirst({ where: { ...parent, ...replayJournalLinkTarget({ trade: "1" })! } })).toBeNull();
  });
  it.each(["ACTIVE", "ARCHIVED"])("permanently deletes a %s session and its owned records, preserving sibling sessions and market data", async (status) => {
    const session = await create("LIVE_REPLAY"), sibling = await create("TRAINING");
    for (const item of [session, sibling]) {
      await account(item); await advance(item); await order(item, "BUY", 1); await advance(item);
      await order(item, "SELL", 1, true); await advance(item);
    }
    // Also retain an open lot and a working order, so deletion cannot leave live trading records behind.
    await order(session, "BUY", 1); await advance(session); await order(session, "SELL", 1, true);
    const drawing = await drawingPOST(request(session, "POST", {
      type: "TREND_LINE", geometry: { start: { timestamp: base.toISOString(), sourceSequence: 0, price: 100 },
        end: { timestamp: new Date(base.getTime() + 60_000).toISOString(), sourceSequence: 1, price: 101 } }, style: DEFAULT_TREND_LINE_STYLE,
    }), context);
    expect(drawing.status).toBe(201);
    const job = await createCorrection(session.id, { requestId: `delete-${status}`, type: "REWIND", targetSequence: 0,
      expectedVersion: (await loadReplayScope(session.id)).version });
    await cancelCorrection(session.id, job.id);
    const entry = await prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: session.activeProjectionId } });
    const reason = await prisma.tradeReason.create({ data: { name: `删除验证 ${status}`, normalizedName: `delete-${status}` } });
    const setup = await prisma.tradeOption.create({ data: { type: "STRATEGY", name: `delete-${status}` } });
    await prisma.replayJournalEntry.update({ where: { id: entry.id }, data: { review: "删除验证备注", setupOptionId: setup.id, tradeReasons: { connect: { id: reason.id } } } });
    if (status === "ARCHIVED") {
      expect((await sessionPATCH(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: (await loadReplayScope(session.id)).version, status }) }), { params: Promise.resolve({ sessionId: session.id }) })).status).toBe(200);
    }
    const projectionId = session.activeProjectionId!;
    const journal = await prisma.replayJournalSession.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const accountId = (await prisma.paperTradingSession.findUniqueOrThrow({ where: { projectionId } })).id;
    const accountWhere = { sessionId: accountId };
    expect(await prisma.paperOrder.count({ where: accountWhere })).toBeGreaterThan(0);
    expect(await prisma.paperFill.count({ where: accountWhere })).toBeGreaterThan(0);
    expect(await prisma.paperTrade.count({ where: accountWhere })).toBeGreaterThan(0);
    expect(await prisma.paperPositionLot.count({ where: accountWhere })).toBeGreaterThan(0);
    expect(await prisma.paperEquityPoint.count({ where: accountWhere })).toBeGreaterThan(0);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: session.id } })).toBeGreaterThan(0);
    expect(await prisma.replayContextRun.count({ where: { projectionId } })).toBeGreaterThan(0);
    expect(await prisma.replayCheckpoint.count({ where: { projectionId } })).toBeGreaterThan(0);
    const siblingState = await prisma.replaySession.findUniqueOrThrow({ where: { id: sibling.id }, include: {
      progress: true, drawings: true, journal: { include: { entries: true } }, commands: true,
      projections: { include: { account: { include: { orders: true, fills: true, trades: true, positionLots: true, equityPoints: true } }, contexts: true, checkpoints: true } },
    } });
    const market = await prisma.marketDataset.findUniqueOrThrow({ where: { id: "shared" } });
    const bars = await prisma.marketBar.findMany({ where: { datasetId: "shared" }, orderBy: { sequence: "asc" } });
    expect((await remove(session.id, { expectedVersion: (await loadReplayScope(session.id)).version })).status).toBe(200);
    expect(await prisma.replaySession.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await prisma.replayProgress.count({ where: { replaySessionId: session.id } })).toBe(0);
    expect(await prisma.replayProjection.count({ where: { replaySessionId: session.id } })).toBe(0);
    expect(await prisma.replayJournalSession.findUnique({ where: { id: journal.id } })).toBeNull();
    expect(await prisma.replayJournalEntry.findUnique({ where: { id: entry.id } })).toBeNull();
    expect(await prisma.paperTradingSession.findUnique({ where: { id: accountId } })).toBeNull();
    expect(await prisma.paperOrder.count({ where: accountWhere })).toBe(0);
    expect(await prisma.paperFill.count({ where: accountWhere })).toBe(0);
    expect(await prisma.paperTrade.count({ where: accountWhere })).toBe(0);
    expect(await prisma.paperPositionLot.count({ where: accountWhere })).toBe(0);
    expect(await prisma.paperEquityPoint.count({ where: accountWhere })).toBe(0);
    expect(await prisma.marketDrawing.count({ where: { replaySessionId: session.id } })).toBe(0);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: session.id } })).toBe(0);
    expect(await prisma.replayProjectionCommand.count({ where: { projectionId } })).toBe(0);
    expect(await prisma.replayContextRun.count({ where: { projectionId } })).toBe(0);
    expect(await prisma.replayCheckpoint.count({ where: { projectionId } })).toBe(0);
    expect(await prisma.replayCorrectionJob.findUnique({ where: { id: job.id } })).toBeNull();
    expect(await prisma.tradeReason.findUniqueOrThrow({ where: { id: reason.id }, include: { replayJournalEntries: true } })).toMatchObject({ replayJournalEntries: [] });
    expect(await prisma.tradeOption.findUnique({ where: { id: setup.id } })).not.toBeNull();
    expect(await prisma.replaySession.findUniqueOrThrow({ where: { id: sibling.id }, include: {
      progress: true, drawings: true, journal: { include: { entries: true } }, commands: true,
      projections: { include: { account: { include: { orders: true, fills: true, trades: true, positionLots: true, equityPoints: true } }, contexts: true, checkpoints: true } },
    } })).toEqual(siblingState);
    expect(await prisma.marketDataset.findUniqueOrThrow({ where: { id: "shared" } })).toEqual(market);
    expect(await prisma.marketBar.findMany({ where: { datasetId: "shared" }, orderBy: { sequence: "asc" } })).toEqual(bars);
    expect((await sessionGET(new Request("http://localhost/api/session"), { params: Promise.resolve({ sessionId: session.id }) })).status).toBe(404);
    expect((await (await sessionsGET(new Request("http://localhost/api/sessions"), context)).json()).sessions.map((item: { id: string }) => item.id)).not.toContain(session.id);
    expect(await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([]);
  });
  it("rejects malformed, stale and correction-locked deletion requests and deletes an empty training session", async () => {
    const session = await create("LIVE_REPLAY");
    for (const body of [{}, { expectedVersion: 0 }, { expectedVersion: "1" }, { expectedVersion: 1, datasetId: "shared" }]) {
      expect((await remove(session.id, body)).status).toBe(400);
    }
    expect((await remove(session.id, { expectedVersion: 2 })).status).toBe(409);
    const job = await createCorrection(session.id, { requestId: "delete-lock", type: "REWIND", targetSequence: -1, expectedVersion: session.version });
    const blocked = await remove(session.id, { expectedVersion: session.version });
    expect(blocked.status).toBe(409); expect((await blocked.json()).code).toBe("CORRECTION_PENDING");
    expect(await prisma.replaySession.findUnique({ where: { id: session.id } })).not.toBeNull();
    await cancelCorrection(session.id, job.id);
    const training = await create("TRAINING");
    expect((await remove(training.id, { expectedVersion: training.version })).status).toBe(200);
    expect((await remove(training.id, { expectedVersion: training.version })).status).toBe(404);
  });
  it("makes the journal session DELETE remove the owned archived session instead of archiving, rejecting other owners", async () => {
    const session = await create("TRAINING"), sibling = await create("TRAINING"); await account(session);
    const journal = await prisma.replayJournalSession.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const routeContext = { params: Promise.resolve({ id: "shared", sessionId: journal.id }) };
    expect((await journalSessionDELETE(request(sibling, "DELETE", { expectedVersion: sibling.version }), routeContext)).status).toBe(404);
    const archived = await sessionPATCH(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: (await loadReplayScope(session.id)).version, status: "ARCHIVED" }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(archived.status).toBe(200);
    expect((await journalSessionDELETE(request(session, "DELETE", { expectedVersion: 1 }), routeContext)).status).toBe(409);
    expect((await journalSessionDELETE(request(session, "DELETE", { expectedVersion: (await loadReplayScope(session.id)).version }), routeContext)).status).toBe(200);
    expect(await prisma.replaySession.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await prisma.replaySession.findUnique({ where: { id: sibling.id } })).not.toBeNull();
  });
  it.each(["ACTIVE", "ARCHIVED"])("renames a %s session and its journal without changing trading state", async (status) => {
    const session = await create("TRAINING"); await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const routeContext = { params: Promise.resolve({ sessionId: session.id }) };
    const patch = (body: unknown) => sessionPATCH(new Request("http://localhost/api/session", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), routeContext);
    if (status === "ARCHIVED") expect((await patch({ expectedVersion: (await loadReplayScope(session.id)).version, status })).status).toBe(200);
    const scope = await loadReplayScope(session.id);
    const before = await snapshot(session.id);
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const projection = await prisma.replayProjection.findUniqueOrThrow({ where: { id: scope.projectionId } });
    const entries = await prisma.replayJournalEntry.findMany({ where: { projectionId: scope.projectionId } });
    const renamed = await patch({ expectedVersion: scope.version, name: "  午盘突破练习  " });
    expect(renamed.status).toBe(200);
    expect(await prisma.replaySession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ name: "午盘突破练习", status, version: scope.version + 1 });
    expect(await prisma.replayJournalSession.findUniqueOrThrow({ where: { replaySessionId: session.id } })).toMatchObject({ name: "午盘突破练习" });
    expect(await snapshot(session.id)).toEqual(before);
    expect(await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).toEqual(progress);
    expect(await prisma.replayProjection.findUniqueOrThrow({ where: { id: scope.projectionId } })).toEqual(projection);
    expect(await prisma.replayJournalEntry.findMany({ where: { projectionId: scope.projectionId } })).toEqual(entries);
    expect((await patch({ expectedVersion: scope.version, name: "过期名称" })).status).toBe(409);
    expect((await patch({ expectedVersion: scope.version + 1, name: " " })).status).toBe(400);
    expect((await patch({ expectedVersion: scope.version + 1, name: "名".repeat(101) })).status).toBe(400);
    if (status === "ARCHIVED") {
      const blocked = await orderPOST(request(session, "POST", { side: "BUY", type: "MARKET", quantity: 1, expectedVersion: before!.session.version }), context);
      expect(blocked.status).toBe(409); expect((await blocked.json()).code).toBe("SESSION_ARCHIVED");
      expect((await patch({ expectedVersion: scope.version + 1, riskPreferences: { riskAmount: 100 } })).status).toBe(409);
    }
  });
  it("renames a session without a journal and retains its name while a correction is pending", async () => {
    const session = await create("LIVE_REPLAY");
    const patch = async (name: string) => sessionPATCH(new Request("http://localhost/api/session", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: (await loadReplayScope(session.id)).version, name }),
    }), { params: Promise.resolve({ sessionId: session.id }) });
    expect((await patch("独立会话名称")).status).toBe(200);
    expect(await prisma.replayJournalSession.count({ where: { replaySessionId: session.id } })).toBe(0);
    const job = await createCorrection(session.id, { requestId: "rename-lock", type: "REWIND", targetSequence: -1, expectedVersion: (await loadReplayScope(session.id)).version });
    const blocked = await patch("纠错中改名");
    expect(blocked.status).toBe(409); expect((await blocked.json()).code).toBe("CORRECTION_PENDING");
    expect((await prisma.replaySession.findUniqueOrThrow({ where: { id: session.id } })).name).toBe("独立会话名称");
    await cancelCorrection(session.id, job.id);
  });
  it("lists active, archived and empty sessions while isolating each journal, statistics and export", async () => {
    const active = await create("TRAINING"), archived = await create("LIVE_REPLAY");
    const empty = await create("TRAINING"), emptyArchived = await create("TRAINING");
    for (const session of [active, archived]) {
      await account(session); await advance(session);
      await order(session, session === active ? "BUY" : "SELL", 1); await advance(session);
      await order(session, session === active ? "SELL" : "BUY", 1, true); await advance(session);
    }
    for (const session of [archived, emptyArchived]) {
      const response = await sessionPATCH(new Request("http://localhost/api/session", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: (await loadReplayScope(session.id)).version, status: "ARCHIVED" }),
      }), { params: Promise.resolve({ sessionId: session.id }) });
      expect(response.status).toBe(200);
    }
    await prisma.marketDataset.create({ data: {
      id: "journal-other-market", name: "Other", symbol: "OTHER", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60,
      barCount: 1, startTime: base, endTime: base,
    } });
    await prisma.marketBar.create({ data: { datasetId: "journal-other-market", sequence: 0, timestamp: base, open: 100, high: 102, low: 99, close: 101 } });
    const foreign = await createReplaySession("journal-other-market", { name: "其他行情会话", mode: "TRAINING", timestamp: base.toISOString(), playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const listed = await (await sessionsGET(new Request("http://localhost/api/sessions"), context)).json();
    expect(listed.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: active.id, status: "ACTIVE", entryCount: 1 }),
      expect.objectContaining({ id: archived.id, status: "ARCHIVED", entryCount: 1 }),
      expect.objectContaining({ id: empty.id, status: "ACTIVE", entryCount: 0 }),
      expect.objectContaining({ id: emptyArchived.id, status: "ARCHIVED", entryCount: 0 }),
    ]));
    expect(listed.sessions.map((session: { id: string }) => session.id)).not.toContain(foreign.id);
    const beforeProgress = await prisma.replayProgress.findMany({ where: { replaySessionId: { in: [active.id, archived.id] } }, orderBy: { id: "asc" } });
    for (const session of [active, archived]) {
      const journal = await (await journalGET(request(session, "GET", undefined, "&scope=history"), context)).json();
      expect(journal.items).toHaveLength(1);
      expect(journal.items[0].direction).toBe(session === active ? "LONG" : "SHORT");
      expect(journal.summary).toMatchObject({ tradeCount: 1, winningTradeCount: session === active ? 1 : 0, losingTradeCount: session === active ? 0 : 1 });
      const journalId = journal.selectedSessionId;
      const exportContext = { params: Promise.resolve({ id: "shared", sessionId: journalId }) };
      const pdf = await (await pdfSnapshotGET(request(session, "GET"), exportContext)).json();
      expect(pdf.entries).toHaveLength(1);
      expect(pdf.entries[0].id).toBe(journal.items[0].id);
      const excel = await excelGET(request(session, "GET"), exportContext);
      expect(excel.status).toBe(200);
      const zip = await JSZip.loadAsync(await excel.arrayBuffer());
      const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
      expect(sheet).toContain(session === active ? "模拟训练" : "实盘重演");
      const wrongOwner = session === active ? archived : active;
      expect((await pdfSnapshotGET(request(wrongOwner, "GET"), exportContext)).status).toBe(404);
    }
    for (const session of [empty, emptyArchived]) {
      const response = await journalGET(request(session, "GET", undefined, "&scope=history"), context);
      expect(response.status).toBe(200); expect((await response.json()).items).toEqual([]);
    }
    expect(await prisma.replayProgress.findMany({ where: { replaySessionId: { in: [active.id, archived.id] } }, orderBy: { id: "asc" } })).toEqual(beforeProgress);
  });
  it.each([60, 300])("rewinds from a selected %s-second chart candle through preview, cancel and confirmation", async (displaySeconds) => {
    const session = await create("LIVE_REPLAY"), sibling = await create("TRAINING");
    await account(session); await account(sibling); await advance(session, 5);
    const expected = await snapshot(session.id), siblingBefore = await snapshot(sibling.id);
    // The order is entered after source candle 4; it triggers on candle 5.
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const original = await snapshot(session.id);
    expect(original!.stats.tradeCount).toBe(1);
    const source = await prisma.marketBar.findMany({ where: { datasetId: "shared", sequence: { lte: 6 } }, orderBy: { sequence: "asc" } });
    const bars = aggregateMarketBars({ bars: source.map((bar) => ({ ...bar, timestamp: bar.timestamp.toISOString() })),
      sourceSeconds: 60, displaySeconds, currentSequence: 6, finalSequence: 7,
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [] } });
    const target = chartRewindTarget(bars, displaySeconds === 60 ? 4 : 0, { minSequence: -1, maxSequence: 6 })!;
    expect(target.sequence).toBe(4);
    const located = await locateGET(new Request(`http://localhost/api/locate?sequence=${target.sequence}`), { params: Promise.resolve({ sessionId: session.id }) });
    expect(located.status).toBe(200);
    const point = await located.json();
    expect(point.sequence).toBe(4);
    expect(formatUtcDateTime(point.timestamp, -240)).toBe("2026/09/30 20:04:00");
    for (const action of ["cancel", "commit"]) {
      const job = await createCorrection(session.id, { requestId: `chart-${displaySeconds}-${action}`, type: "REWIND",
        targetSequence: target.sequence, expectedVersion: (await loadReplayScope(session.id)).version });
      await runReplayCorrection(job.id);
      const preview = await readCorrection(session.id, job.id);
      expect(preview.status).toBe("READY");
      expect(preview.summary).toMatchObject({ beforeEntries: 1, afterEntries: 0, originalSequence: 6 });
      expect(await snapshot(session.id)).toEqual(original);
      if (action === "cancel") { await cancelCorrection(session.id, job.id); expect(await snapshot(session.id)).toEqual(original); }
      else await commitCorrection(session.id, job.id);
    }
    const corrected = await snapshot(session.id);
    expect(corrected!.session).toEqual(expected!.session);
    expect(corrected!.activeOrders).toEqual(expected!.activeOrders);
    expect(corrected!.openLots).toEqual(expected!.openLots);
    expect(corrected!.stats.tradeCount).toBe(0);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(4);
    expect(await snapshot(sibling.id)).toEqual(siblingBefore);
    expect(await prisma.marketBar.count({ where: { datasetId: "shared" } })).toBe(8);
  });
  it("restores the target close before user actions and removes the replaced result", async () => {
    const session = await create("LIVE_REPLAY");
    await account(session); await advance(session); await order(session, "BUY", 2);
    const expected = await advance(session, 2);
    await order(session, "SELL", 1, true); await advance(session);
    const before = await snapshot(session.id);
    expect(before!.session.netQuantity).toBe(1);
    const job = await createCorrection(session.id, { requestId: "rewind-target", type: "REWIND", targetSequence: 2, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id);
    const ready = await prisma.replayCorrectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(ready.error).toBeNull(); expect(ready.status).toBe("READY");
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(1);
    await commitCorrection(session.id, job.id);
    const restored = await snapshot(session.id);
    expect(restored!.session).toEqual(expected!.session);
    expect(restored!.activeOrders).toEqual(expected!.activeOrders);
    expect(restored!.openLots).toEqual(expected!.openLots);
    expect(await prisma.replayProjection.findUnique({ where: { id: session.activeProjectionId } })).toBeNull();
    expect(await prisma.paperFill.count({ where: { session: { projectionId: session.activeProjectionId } } })).toBe(0);
    expect(await prisma.paperFill.count({ where: { session: { projectionId: ready.targetProjectionId } } })).toBe(1);
    expect(await prisma.replayProjection.count({ where: { replaySessionId: session.id } })).toBe(1);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: session.id, projections: { none: {} } } })).toBe(0);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(2);
    const rejected = await orderPOST(request(session, "POST", { side: "SELL", type: "MARKET", price: null, quantity: 1, expectedVersion: restored!.session.version }), context);
    expect(rejected.status).toBe(409);
  });
  it("deletes a closed cycle and keeps internal identities while compacting visible numbers", async () => {
    const session = await create("LIVE_REPLAY");
    await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const originals = await prisma.replayJournalEntry.findMany({ where: { projectionId: session.activeProjectionId }, orderBy: { closedSequence: "asc" } });
    expect(originals).toHaveLength(2);
    await prisma.replayJournalEntry.update({ where: { id: originals[1].id }, data: { review: "后续交易复盘保留" } });
    const job = await createCorrection(session.id, { requestId: "delete-cycle", type: "DELETE_CYCLE", cycleKey: originals[0].cycleKey!, expectedVersion: (await loadReplayScope(session.id)).version });
    expect((await createCorrection(session.id, { requestId: "delete-cycle", type: "DELETE_CYCLE", cycleKey: originals[0].cycleKey!, expectedVersion: job.expectedVersion })).id).toBe(job.id);
    await runReplayCorrection(job.id);
    const ready = await prisma.replayCorrectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(ready.error).toBeNull(); expect(ready.status).toBe("READY");
    // Annotation changes during the preview are refreshed at commit.
    const annotated = await entryPATCH(request(session, "PATCH", { review: "确认前的新复盘" }), { params: Promise.resolve({ id: "shared", entryId: originals[1].id }) });
    expect(annotated.status).toBe(200);
    expect(await prisma.replayJournalEntry.findFirst({ where: { projectionId: ready.targetProjectionId, logicalKey: originals[1].logicalKey } })).toMatchObject({ review: "后续交易复盘保留" });
    await commitCorrection(session.id, job.id);
    const corrected = await snapshot(session.id);
    expect(corrected!.stats.tradeCount).toBe(1);
    expect(corrected!.session.netQuantity).toBe(0);
    const entries = await prisma.replayJournalEntry.findMany({ where: { projectionId: ready.targetProjectionId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ logicalKey: originals[1].logicalKey, accountNo: originals[1].accountNo, no: originals[1].no,
      entryPrice: originals[1].entryPrice, exitPrice: originals[1].exitPrice, quantity: originals[1].quantity, review: "确认前的新复盘" });
    const visible = await (await journalGET(request(session, "GET"), context)).json();
    expect(visible.items).toMatchObject([{ id: entries[0].id, no: 1, globalNo: originals[1].no, review: "确认前的新复盘" }]);
    expect(await prisma.replayJournalEntry.count({ where: { projectionId: session.activeProjectionId } })).toBe(0);
    expect(await prisma.replayProjection.count({ where: { replaySessionId: session.id } })).toBe(1);
    expect(await prisma.paperTradingSession.count({ where: { journalSession: { replaySessionId: session.id } } })).toBe(1);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: session.id, projections: { none: {} } } })).toBe(0);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(4);
    const current = { ...session, activeProjectionId: ready.targetProjectionId };
    const currentJournal = await journalGET(request(current, "GET", undefined, "&scope=history"), context);
    expect((await currentJournal.json()).pagination.totalItems).toBe(1);
    const journal = await prisma.replayJournalSession.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const currentExport = await pdfSnapshotGET(request(current, "GET"), { params: Promise.resolve({ id: "shared", sessionId: journal.id }) });
    const exported = await currentExport.json();
    expect(exported.entries).toHaveLength(1); expect(exported.session.name).toContain("实盘重演"); expect(exported.session.name).toContain("回放撮合");
    expect(exported.session.name).not.toContain("版本");
    expect(exported.endSequence).toBe(4);
  });
  it("leaves the visible state unchanged on cancellation or history conflicts", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session, 2);
    const original = await snapshot(session.id);
    const job = await createCorrection(session.id, { requestId: "cancel", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id); await cancelCorrection(session.id, job.id);
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    expect(await snapshot(session.id)).toEqual(original);
    expect(await prisma.replayProjection.count({ where: { replaySessionId: session.id } })).toBe(1);
    expect((await readCorrection(session.id, job.id)).targetProjectionId).toBeNull();
    const next = await createCorrection(session.id, { requestId: "history-conflict", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(next.id);
    await prisma.marketDataset.update({ where: { id: "shared" }, data: { historyVersion: { increment: 1 } } });
    await expect(commitCorrection(session.id, next.id)).rejects.toMatchObject({ code: "HISTORY_CHANGED" });
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    await cancelCorrection(session.id, next.id);
    await prisma.marketDataset.update({ where: { id: "shared" }, data: { historyVersion: { decrement: 1 } } });
  });
  it("freezes writes during preview and retains the visible account after a reconstruction failure", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session, 4);
    const original = await snapshot(session.id);
    const input = { requestId: "missing-context", type: "REWIND" as const, targetSequence: 2, expectedVersion: (await loadReplayScope(session.id)).version };
    const job = await createCorrection(session.id, input);
    expect((await createCorrection(session.id, input)).id).toBe(job.id);
    const blocked = await orderPOST(request(session, "POST", { side: "BUY", type: "MARKET", quantity: 1, expectedVersion: original!.session.version }), context);
    expect(blocked.status).toBe(409);
    expect(await prisma.paperOrder.count({ where: { session: { projectionId: session.activeProjectionId } } })).toBe(0);
    await prisma.replayContextRun.deleteMany({ where: { projectionId: session.activeProjectionId! } });
    await runReplayCorrection(job.id);
    expect((await readCorrection(session.id, job.id)).status).toBe("FAILED");
    expect((await prisma.replaySession.findUniqueOrThrow({ where: { id: session.id } })).pendingCorrectionId).toBeNull();
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    expect(await snapshot(session.id)).toEqual(original);
    expect(await prisma.replayProjection.count({ where: { replaySessionId: session.id } })).toBe(1);
    expect((await readCorrection(session.id, job.id)).targetProjectionId).toBeNull();
    await expect(commitCorrection(session.id, job.id)).rejects.toMatchObject({ code: "CORRECTION_NOT_READY" });
  });
  it("allows past-only location for training and future location for live replay without moving either cursor", async () => {
    const training = await create("TRAINING");
    const live = await create("LIVE_REPLAY");
    await account(training); await account(live); await advance(training, 2); await advance(live, 2);
    const ctx = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });
    const time = new Date(base.getTime() + 180_000).toISOString();
    const rejected = await locateGET(new Request(`http://localhost/api/locate?timestamp=${encodeURIComponent(time)}&direction=FORWARD`), ctx(training.id));
    expect(rejected.status).toBe(403);
    const past = await locateGET(new Request(`http://localhost/api/locate?timestamp=${encodeURIComponent(base.toISOString())}`), ctx(training.id));
    expect((await past.json()).sequence).toBe(0);
    const future = await locateGET(new Request(`http://localhost/api/locate?timestamp=${encodeURIComponent(time)}&direction=FORWARD`), ctx(live.id));
    expect((await future.json()).sequence).toBe(3);
    for (const session of [training, live]) expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(1);
  });
  it("runs reconstruction in a separate Node process using the same database", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session, 3);
    const job = await createCorrection(session.id, { requestId: "separate-process", type: "REWIND", targetSequence: 1, expectedVersion: (await loadReplayScope(session.id)).version });
    const pid = await startReplayCorrectionWorker(job.id);
    expect(pid).not.toBe(process.pid);
    let state = await readCorrection(session.id, job.id);
    const deadline = Date.now() + 12_000;
    while (["QUEUED", "RUNNING"].includes(state.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await readCorrection(session.id, job.id);
    }
    expect(state.error).toBeNull(); expect(state.status).toBe("READY");
    expect(state.workerPid).toBe(pid);
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    await commitCorrection(session.id, job.id);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(1);
  }, 20_000);
  it("unfreezes the session when a queued worker process is missing", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    const job = await createCorrection(session.id, { requestId: "interrupted", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await prisma.replayCorrectionJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date(Date.now() - 60_000), workerPid: null } });
    const state = await readCorrection(session.id, job.id);
    expect(state.status).toBe("INTERRUPTED");
    expect((await prisma.replaySession.findUniqueOrThrow({ where: { id: session.id } })).pendingCorrectionId).toBeNull();
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
  });
  it("treats additions, partial closes and direct reversals as one complete cycle", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 2); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    await order(session, "SELL", 4); await advance(session);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(-2);
    await order(session, "BUY", 2, true); await advance(session);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
    const firstCycle = await prisma.paperFill.findFirstOrThrow({ where: { session: { projectionId: session.activeProjectionId } }, orderBy: { sequence: "asc" } });
    const firstFills = await prisma.paperFill.findMany({ where: { session: { projectionId: session.activeProjectionId } } });
    expect(firstFills).toHaveLength(5);
    expect(new Set(firstFills.map((fill) => fill.cycleKey))).toEqual(new Set([firstCycle.cycleKey]));
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const survivor = await prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: session.activeProjectionId, closedSequence: 7 } });
    const job = await createCorrection(session.id, { requestId: "complex-cycle", type: "DELETE_CYCLE", cycleKey: firstCycle.cycleKey!, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id);
    const ready = await readCorrection(session.id, job.id); expect(ready.error).toBeNull(); expect(ready.status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const head = await loadReplayScope(session.id);
    const entries = await prisma.replayJournalEntry.findMany({ where: { projectionId: head.projectionId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ logicalKey: survivor.logicalKey, entryPrice: survivor.entryPrice, exitPrice: survivor.exitPrice, accountNo: survivor.accountNo, no: survivor.no });
    expect((await snapshot(session.id))!.stats.tradeCount).toBe(1);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
  });
  it("restores protective amendments and FIFO risk values across a rewind", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    const initial = await snapshot(session.id);
    const entry = await orderPOST(request(session, "POST", { side: "BUY", type: "LIMIT", price: 101, quantity: 2, stopLoss: 99, takeProfit: 109, expectedVersion: initial!.session.version }), context);
    expect(entry.status).toBe(201); await advance(session);
    let current = await snapshot(session.id);
    const stop = current!.activeOrders.find((order) => order.isProtective && order.type === "STOP")!;
    const amendStop = await amendOrderPATCH(request(session, "PATCH", { price: 100.5, expectedVersion: current!.session.version }), { params: Promise.resolve({ id: "shared", orderId: stop.id }) });
    expect(amendStop.status).toBe(200);
    const expected = await advance(session);
    current = await snapshot(session.id);
    const target = current!.activeOrders.find((order) => order.isProtective && order.type === "LIMIT")!;
    const amendTarget = await amendOrderPATCH(request(session, "PATCH", { price: 104.5, expectedVersion: current!.session.version }), { params: Promise.resolve({ id: "shared", orderId: target.id }) });
    expect(amendTarget.status).toBe(200); await advance(session);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
    const job = await createCorrection(session.id, { requestId: "protective-rewind", type: "REWIND", targetSequence: 2, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id); expect((await readCorrection(session.id, job.id)).status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const restored = await snapshot(session.id);
    expect(restored!.session).toEqual(expected!.session);
    expect(restored!.activeOrders).toEqual(expected!.activeOrders);
    expect(restored!.openLots).toEqual(expected!.openLots);
    // A second correction can still reach before the previous reconstruction start.
    const next = await createCorrection(session.id, { requestId: "second-rewind", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(next.id); expect((await readCorrection(session.id, next.id)).status).toBe("READY");
    await commitCorrection(session.id, next.id);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
    expect((await snapshot(session.id))!.activeOrders).toHaveLength(0);
    expect(await prisma.replayProjection.count({ where: { replaySessionId: session.id } })).toBe(1);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: session.id, projections: { none: {} } } })).toBe(0);
    const head = (await loadReplayScope(session.id)).projectionId;
    expect(await commitCorrection(session.id, job.id)).toEqual({ ok: true, projectionId: head });
    expect((await loadReplayScope(session.id)).projectionId).toBe(head);
  });
  it("rolls back the entire replacement if old-result cleanup fails", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session, 3);
    const original = await snapshot(session.id);
    const job = await createCorrection(session.id, { requestId: "atomic-replace", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_result_cleanup BEFORE DELETE ON ReplayProjection
      WHEN OLD.id = '${session.activeProjectionId}' BEGIN SELECT RAISE(ABORT, 'test cleanup failure'); END`);
    try {
      await expect(commitCorrection(session.id, job.id)).rejects.toThrow();
      expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
      expect(await snapshot(session.id)).toEqual(original);
      expect((await readCorrection(session.id, job.id)).status).toBe("READY");
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_result_cleanup"); }
    await commitCorrection(session.id, job.id);
    expect(await prisma.replayProjection.count({ where: { replaySessionId: session.id } })).toBe(1);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(0);
  });
  it("preserves orders created and cancelled on the checkpoint bar", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 1);
    const current = await snapshot(session.id);
    const pending = current!.activeOrders[0];
    const canceled = await cancelOrderDELETE(request(session, "DELETE", { expectedVersion: current!.session.version }), { params: Promise.resolve({ id: "shared", orderId: pending.id }) });
    expect(canceled.status).toBe(200);
    await advance(session, 3);
    const before = await prisma.paperOrder.findFirstOrThrow({ where: { session: { projectionId: session.activeProjectionId }, status: "CANCELLED" } });
    const job = await createCorrection(session.id, { requestId: "same-bar-cancel", type: "REWIND", targetSequence: 1, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id); expect((await readCorrection(session.id, job.id)).status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const after = await prisma.paperOrder.findFirstOrThrow({ where: { session: { projectionId: (await loadReplayScope(session.id)).projectionId }, status: "CANCELLED" } });
    expect(after).toMatchObject({ createdSequence: before.createdSequence, cancelReason: before.cancelReason, quantity: before.quantity, side: before.side });
    expect((await snapshot(session.id))!.activeOrders).toHaveLength(0);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
  });
});
