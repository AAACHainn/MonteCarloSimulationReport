import { execFileSync } from "node:child_process";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(process.cwd(), "tmp", `drawing-history-20261108-${randomUUID()}.db`)}` }, { allowCreate: true }), replayDatabaseQueryCount: () => null };
});
import { prisma } from "@/lib/db";
import { createReplaySession } from "./service";
import { loadReplayScope } from "./scope";
import { POST as createDrawing, DELETE as clearDrawings, GET as readDrawings } from "@/app/api/market-datasets/[id]/drawings/route";
import { PATCH as updateDrawing, DELETE as deleteDrawing } from "@/app/api/market-datasets/[id]/drawings/[drawingId]/route";
import { POST as applyChanges } from "@/app/api/market-datasets/[id]/drawings/changes/route";
import { PATCH as patchSession } from "@/app/api/replay-sessions/[sessionId]/route";
import { DEFAULT_TREND_LINE_STYLE, DEFAULT_RECTANGLE_STYLE, type MarketDrawing } from "@/lib/market-replay/chart-drawings";
import { randomUUID } from "node:crypto";
const base = new Date("2026-11-08T00:00:00.000Z"), context = { params: Promise.resolve({ id: "history-data" }) };
const geometry = { start: { timestamp: base.toISOString(), sourceSequence: 0, price: 100 }, end: { timestamp: new Date(+base + 60_000).toISOString(), sourceSequence: 1, price: 102 } };
type Session = Awaited<ReturnType<typeof createReplaySession>>;
function request(session: Session, method: string, body?: unknown, projection = session.activeProjectionId!) {
  return new Request(`http://localhost/api/test?replaySessionId=${session.id}`, { method, headers: { "Content-Type": "application/json", "X-Replay-Projection": projection }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const itemContext = (id: string) => ({ params: Promise.resolve({ id: "history-data", drawingId: id }) });
const session = () => createReplaySession("history-data", { name: "Drawing edits", mode: "TRAINING", timestamp: base.toISOString(), playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
async function add(scope: Session, clientId = randomUUID()) {
  const response = await createDrawing(request(scope, "POST", { type: "TREND_LINE", clientId, geometry, style: DEFAULT_TREND_LINE_STYLE }), context);
  expect(response.status).toBe(201); return (await response.json()).drawing as MarketDrawing;
}
async function read(scope: Session) { return (await (await readDrawings(request(scope, "GET"), context)).json()).drawings as MarketDrawing[]; }
beforeAll(async () => {
  const file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  console.info("Synthetic drawing-history database retained:", file);
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: { id: "history-data", name: "History test", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 4, startTime: base, endTime: new Date(+base + 180_000) } });
  await prisma.marketBar.createMany({ data: Array.from({ length: 4 }, (_, sequence) => ({ datasetId: "history-data", sequence, timestamp: new Date(+base + sequence * 60_000), open: 100, high: 110, low: 90, close: 102 })) });
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); });
describe("transactional drawing undo/redo without schema changes", () => {
  it("creates retry-safe copies for non-text types and rejects ID reuse across sessions", async () => {
    const scope = await session(), id = randomUUID(); const first = await add(scope, id), second = await add(scope, id);
    expect(second).toEqual(first); expect(await read(scope)).toHaveLength(1);
    const other = await session(); expect((await createDrawing(request(other, "POST", { type: "TREND_LINE", clientId: id, geometry }), context)).status).toBe(409);
    expect((await createDrawing(request(scope, "POST", { type: "RECTANGLE", clientId: id, geometry, style: DEFAULT_RECTANGLE_STYLE }), context)).status).toBe(409);
  });
  it("restores a cleared group atomically with original IDs/order and preserves concurrent additions", async () => {
    const scope = await session(), a = await add(scope), b = await add(scope);
    expect((await clearDrawings(request(scope, "DELETE", { ids: [a.id, b.id] }), context)).status).toBe(200);
    const concurrent = await add(scope);
    const changes = [a, b].map(before => ({ id: before.id, before: null, after: before }));
    const first = await applyChanges(request(scope, "POST", { changes }), context); expect(first.status).toBe(200);
    const again = await applyChanges(request(scope, "POST", { changes }), context); expect(again.status).toBe(200);
    const restored = await read(scope); expect(restored).toHaveLength(3);
    expect(restored.find(row => row.id === a.id)?.createdAt).toBe(a.createdAt); expect(restored.some(row => row.id === concurrent.id)).toBe(true);
    expect((await applyChanges(request(scope, "POST", { changes: [a, b].map(before => ({ id: before.id, before, after: null })) }), context)).status).toBe(200);
    expect((await read(scope)).map(row => row.id)).toEqual([concurrent.id]);
  });
  it("returns authoritative before snapshots and refuses an ambiguous paste retry over someone else's edit", async () => {
    const scope = await session(), original = await add(scope);
    const updated = await updateDrawing(request(scope, "PATCH", { style: { ...DEFAULT_TREND_LINE_STYLE, width: 4 } }), itemContext(original.id));
    expect((await updated.json()).historyBefore).toEqual(original);
    const retry = request(scope, "POST", { type: "TREND_LINE", clientId: original.id, geometry, style: DEFAULT_TREND_LINE_STYLE });
    retry.headers.set("X-Drawing-Action", "paste");
    expect((await createDrawing(retry, context)).status).toBe(409);
    expect((await read(scope))[0].style).toMatchObject({ width: 4 });
    const cleared = await clearDrawings(request(scope, "DELETE", { ids: [original.id, "already-absent"] }), context);
    const result = await cleared.json(); expect(result.historyBefore).toHaveLength(1); expect(result.historyBefore[0].style.width).toBe(4);
  });
  it("rejects the entire undo if one object was edited by another writer", async () => {
    const scope = await session(), a = await add(scope), b = await add(scope);
    await deleteDrawing(request(scope, "DELETE"), itemContext(a.id));
    await updateDrawing(request(scope, "PATCH", { style: { ...DEFAULT_TREND_LINE_STYLE, width: 4 } }), itemContext(b.id));
    const result = await applyChanges(request(scope, "POST", { changes: [{ id: a.id, before: null, after: a }, { id: b.id, before: b, after: null }] }), context);
    expect(result.status).toBe(409); const rows = await read(scope); expect(rows).toHaveLength(1); expect(rows[0].id).toBe(b.id); expect(rows[0].style).toMatchObject({ width: 4 });
  });
  it("supports archived drawing undo but rejects foreign sessions and stale projection headers without changing trading state", async () => {
    const scope = await session(), original = await add(scope), foreign = await session();
    const changes = [{ id: original.id, before: original, after: { ...original, style: { ...DEFAULT_TREND_LINE_STYLE, width: 3 } } }];
    expect((await applyChanges(request(foreign, "POST", { changes }), context)).status).toBe(409);
    expect((await applyChanges(request(scope, "POST", { changes }, "old-projection"), context)).status).toBe(409);
    await patchSession(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: (await loadReplayScope(scope.id)).version, status: "ARCHIVED" }) }), { params: Promise.resolve({ sessionId: scope.id }) });
    const accountsBefore = await prisma.paperTradingSession.findMany();
    expect((await applyChanges(request(scope, "POST", { changes }), context)).status).toBe(200);
    expect(await prisma.paperTradingSession.findMany()).toEqual(accountsBefore);
    expect((await read(scope))[0].style).toMatchObject({ width: 3 });
  });
});
