import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path"), { randomUUID } = await import("node:crypto");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), `growth-settlement-${randomUUID()}.db`)}` }, { allowCreate: true }), replayDatabaseQueryCount: () => null };
});
import { prisma } from "@/lib/db";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { createReplaySession, archiveReplaySession, deleteReplaySession } from "@/lib/replay-sessions/service";
import { loadReplayScope, runWithReplayScope } from "@/lib/replay-sessions/scope";
import { saveProfile, assignHistory } from "./service";
import { settleGrowth, sourceKey, rebuildGrowth, breakthroughFoundation } from "./settlement";
import { readGrowthRecords, readGrowthView } from "./read";
import { FOUNDATION_REQUIREMENTS } from "./rules";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { POST as orderPOST } from "@/app/api/market-datasets/[id]/paper-session/orders/route";
import { POST as advancePOST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { PATCH as reviewPATCH } from "@/app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route";
import { POST as breakthroughPOST } from "@/app/api/users/[userId]/breakthrough/route";
import { GET as recordsGET } from "@/app/api/users/[userId]/growth-records/route";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { savePropTemplate, confirmPropPromotion, confirmPropPayout } from "@/lib/prop-practice/service";

import { defaultPropRules, type PropRules } from "@/lib/prop-practice/rules";
let file = "", userNo = 0;
const times = ["2026-10-01T23:58:00Z", "2026-10-01T23:59:00Z", "2026-10-02T00:00:00Z", "2026-10-02T00:01:00Z", "2026-10-02T23:59:00Z", "2026-10-03T00:00:00Z", "2026-10-03T23:59:00Z", "2026-10-04T00:00:00Z"];
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: { id: "growth", name: "Growth", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: times.length, startTime: new Date(times[0]), endTime: new Date(times.at(-1)!) } });
  await prisma.marketBar.createMany({ data: times.map((timestamp, sequence) => ({ datasetId: "growth", sequence, timestamp: new Date(timestamp), open: 100 + sequence * 10, high: 115 + sequence * 10, low: 95 + sequence * 10, close: 110 + sequence * 10 })) });
}, 30000);
afterAll(async () => { await prisma.$disconnect(); if (file.includes("growth-settlement-")) rmSync(file, { force: true }); });
type Session = Awaited<ReturnType<typeof createReplaySession>>;
const ctx = { params: Promise.resolve({ id: "growth" }) };
const user = () => saveProfile({ nickname: `成长测试${++userNo}` });
function request(s: Session, method: string, body: unknown) { return new Request(`http://192.168.1.2/api/test?replaySessionId=${s.id}`, { method, headers: { "Content-Type": "application/json", "X-Replay-Projection": s.activeProjectionId }, body: JSON.stringify(body) }); }
async function scoped<T>(s: Session, work: () => Promise<T>) { return runWithReplayScope(await loadReplayScope(s.id), work); }
const snapshot = (s: Session) => scoped(s, () => getPaperSessionSnapshot("growth"));
function propRules(): PropRules { const r = structuredClone(defaultPropRules); r.name = "Growth arbitrary template"; r.evaluation.risk = { initialCapital: 1000, drawdown: 900, mode: "STATIC", capOffset: null }; r.funded.risk = { ...r.evaluation.risk }; r.evaluation.target = 1; r.evaluation.minTradingDays = null; r.evaluation.consistency = null; r.payout = { minimum: 1, fraction: 1, maximum: null, buffer: null, traderShare: 0.9, permanentFloorOffset: null }; return r; }
async function create(options: { owner?: Awaited<ReturnType<typeof user>> | null; mode?: "TRAINING" | "LIVE_REPLAY"; rules?: PropRules; currency?: string } = {}) {
  const owner = options.owner === undefined ? await user() : options.owner;
  const s = await createReplaySession("growth", { name: "Growth session", userId: owner?.id, mode: options.mode ?? "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
  const template = options.rules ? await savePropTemplate(options.rules) : null;
  const response = await accountPOST(request(s, "POST", { initialCapital: 1000, currency: options.currency ?? "USDT", commissionBps: 1, slippageBps: 1,
    ...(template ? { accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id } : {}) }), ctx);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201); return { s, owner };
}
async function advance(s: Session, count = 1) { const snap = (await snapshot(s))!, scope = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: s.id } });
  const body = { count, expectedVersion: snap.session.version, expectedCurrentSequence: scope.currentSequence, requestId: randomUUID() };
  const response = await advancePOST(request(s, "POST", body), ctx); const data = await response.json(); expect(response.status, JSON.stringify(data)).toBe(200); return data;
}
async function order(s: Session, side: "BUY" | "SELL", quantity = 1, close = false) {
  const response = await orderPOST(request(s, "POST", { side, quantity, type: "MARKET", expectedVersion: (await snapshot(s))!.session.version, ...(close ? { reduceOnly: true, executeAtCurrentClose: true } : {}) }), ctx);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201); return response.json();
}
async function cycle(s: Session) { await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, true); }
const totals = (id: string) => prisma.userGrowth.findUniqueOrThrow({ where: { userId: id } });
async function entry(s: Session) { return prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: (await loadReplayScope(s.id)).projectionId }, orderBy: { no: "asc" } }); }
async function review(s: Session, row: Awaited<ReturnType<typeof entry>>, value: string, expected = row.review, extra = {}) {
  return reviewPATCH(request(s, "PATCH", { review: value, expectedReview: expected, expectedProjectionId: s.activeProjectionId, ...extra }), { params: Promise.resolve({ id: "growth", entryId: row.id }) });
}

describe("daily rewards in actual trading and review transactions", () => {
  it("does not reward pure advance, partial exits or FIFO rows as separate cycles", async () => {
    const { s, owner } = await create(); await advance(s); expect((await totals(owner!.id)).totalXp).toBe(0);
    await order(s, "BUY", 2); await advance(s); await order(s, "SELL", 1, true);
    expect((await totals(owner!.id)).completedCycles).toBe(0); await order(s, "SELL", 1, true);
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 5, completedCycles: 1 });
    const entries = await prisma.replayJournalEntry.findMany({ where: { projectionId: s.activeProjectionId } }); expect(entries).toHaveLength(2);
    for (const row of entries) expect((await review(s, row, `复盘 ${row.id}`)).status).toBe(200);
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 25, completedReviews: 2, completedCycles: 1 });
  });
  it("counts reversals using the original completed PaperTrade cycle rule", async () => {
    const { s, owner } = await create(); await advance(s); await order(s, "BUY"); await advance(s);
    await order(s, "SELL", 3); await advance(s);
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 5, completedCycles: 1 });
    expect((await snapshot(s))!.session.netQuantity).toBe(-2); await order(s, "BUY", 2, true);
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 10, completedCycles: 2 });
  });
  it("awards one changed nonempty review, preserves CAS conflicts and deduplicates retries", async () => {
    const { s, owner } = await create(); await cycle(s); const row = await entry(s);
    expect((await review(s, row, "  \n ")).status).toBe(200); expect((await totals(owner!.id)).completedReviews).toBe(0);
    const first = await review(s, row, "自己的复盘", "  \n "); expect(first.status).toBe(200);
    expect((await first.json()).growth).toMatchObject({ nickname: owner!.nickname, xp: 10, awarded: true });
    const retry = await review(s, row, "自己的复盘", "  \n "); expect(retry.status).toBe(200);
    expect((await retry.json()).growth.awarded).toBe(false);
    expect((await review(s, row, "过期覆盖", "  \n ")).status).toBe(409);
    const fresh = await entry(s); expect((await review(s, fresh, "")).status).toBe(200);
    expect((await review(s, fresh, "清空后重填", "")).status).toBe(200);
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 15, completedReviews: 1 });
  });
  it("does not reward saving unchanged prefill, whitespace-only edits or metadata-only saves", async () => {
    const { s, owner } = await create(); await cycle(s); let row = await entry(s);
    await prisma.replayJournalEntry.update({ where: { id: row.id }, data: { review: "系统预填" } }); row = await entry(s);
    expect((await review(s, row, "系统预填")).status).toBe(200);
    expect((await review(s, row, " 系统预填 \n")).status).toBe(200);
    const response = await reviewPATCH(request(s, "PATCH", { setupOptionId: null }), { params: Promise.resolve({ id: "growth", entryId: row.id }) }); expect(response.status).toBe(200);
    expect((await totals(owner!.id)).completedReviews).toBe(0);
  });
  it("allows the first review on an archived qualified training without losing data after deletion", async () => {
    const { s, owner } = await create(); await cycle(s); const row = await entry(s);
    await scoped(s, () => sqliteWriteTransaction(prisma, archiveReplaySession));
    expect((await review(s, row, "归档后的首次复盘")).status).toBe(200);
    const before = await totals(owner!.id), key = (await prisma.userGrowthFact.findFirstOrThrow({ where: { userId: owner!.id, type: "REVIEW" } })).sourceKey;
    const deleteScope = await loadReplayScope(s.id);
    await runWithReplayScope(deleteScope, () => sqliteWriteTransaction(prisma, tx => deleteReplaySession(tx, deleteScope.version)));
    expect(await totals(owner!.id)).toEqual(before);
    const rebuilt = await sqliteWriteTransaction(prisma, tx => rebuildGrowth(tx, owner!.id)); expect(rebuilt).toMatchObject({ totalXp: 15, completedCycles: 1, completedReviews: 1 });
    expect(await prisma.userGrowthFact.findUnique({ where: { sourceKey: key } })).not.toBeNull();
    expect((await readGrowthRecords(owner!.id)).items.every(item => item.deleted)).toBe(true);
  });
  it.each(["unassigned", "historical", "replay"])("excludes %s sessions while preserving their trading/review operations", async kind => {
    const owner = await user(); const { s } = await create({ owner: kind === "historical" || kind === "unassigned" ? null : owner, mode: kind === "replay" ? "LIVE_REPLAY" : "TRAINING" });
    if (kind === "historical") await assignHistory(owner.id, [s.id]); await cycle(s);
    const row = await entry(s); expect((await review(s, row, "可以保存，但不发成长")).status).toBe(200);
    expect(await totals(owner.id)).toMatchObject({ totalXp: 0, completedReviews: 0, completedCycles: 0 });
  });
  it("rolls back the original close and all growth if growth persistence fails", async () => {
    const { s, owner } = await create(); await advance(s); await order(s, "BUY"); await advance(s); const before = (await snapshot(s))!;
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_growth BEFORE INSERT ON UserGrowthFact WHEN NEW.type='CYCLE' BEGIN SELECT RAISE(ABORT,'growth test failure'); END`);
    try {
      const response = await orderPOST(request(s, "POST", { side: "SELL", quantity: 1, type: "MARKET", reduceOnly: true, executeAtCurrentClose: true, expectedVersion: before.session.version }), ctx); expect(response.status).toBe(500);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER fail_growth"); }
    expect((await snapshot(s))!.session).toEqual(before.session); expect((await totals(owner!.id)).totalXp).toBe(0);
    await order(s, "SELL", 1, true); expect((await totals(owner!.id)).totalXp).toBe(5);
  });
  it("verifies AI adoption from a completed run and its exact entry even when text is unchanged", async () => {
    const { s, owner } = await create(); await cycle(s); const row = await entry(s);
    await prisma.replayJournalEntry.update({ where: { id: row.id }, data: { review: "相同 AI 复盘" } });
    const original = await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: row.id }, include: { setupOption: { select: { name: true } }, tradeReasons: { select: { id: true, name: true } } } });
    const convo = await prisma.aiConversation.create({ data: { name: "Growth AI fixture" } });
    const context = await prisma.aiContext.create({ data: { value: JSON.stringify({ replaySessionId: s.id, projectionId: s.activeProjectionId, selectedEntryId: row.id, entries: [original] }) } });
    const run = await prisma.aiRun.create({ data: { id: randomUUID(), conversationId: convo.id, contextId: context.id, task: "reviewDraft", status: "COMPLETED", snapshot: "{}" } });
    await prisma.aiMessage.create({ data: { conversationId: convo.id, runId: run.id, contextId: context.id, role: "assistant", content: "draft", result: JSON.stringify({ draft: original.review }) } });
    const accepted = await review(s, original, original.review, original.review, { aiSourceRunId: run.id }); expect(accepted.status).toBe(200);
    expect((await totals(owner!.id)).completedReviews).toBe(1);
    const another = await create(); await cycle(another.s); const otherRow = await entry(another.s);
    expect((await review(another.s, otherRow, "wrong target", otherRow.review, { aiSourceRunId: run.id })).status).toBe(409);
    await prisma.aiRun.update({ where: { id: run.id }, data: { status: "FAILED" } });
    expect((await review(s, original, "new", original.review, { aiSourceRunId: run.id })).status).toBe(409);
    expect((await totals(owner!.id)).completedReviews).toBe(1);
  });
});

async function funded(currency = "USDT") {
  const created = await create({ rules: propRules(), currency }); await cycle(created.s);
  expect((await snapshot(created.s))!.propAccount!.state.phase).toBe("FUNDED");
  await cycle(created.s); return created;
}
async function payout(s: Session, amount = 5) { return scoped(s, async () => confirmPropPayout({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount })); }
describe("prop account result settlement", () => {
  it.each(["USDT", "USD"])("settles actual %s promotion and payouts atomically with retry deduplication", async currency => {
    const { s, owner } = await funded(currency); const before = (await snapshot(s))!;
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 110, passedEvaluations: 1, completedCycles: 2 });
    const input = { expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount: 5 };
    const results = await Promise.all([scoped(s, () => confirmPropPayout(input)), scoped(s, () => confirmPropPayout(input))]);
    expect(results[0].id).toBe(results[1].id);
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 310, successfulPayouts: 1, receivedUsdtMinor: BigInt(currency === "USDT" ? 450 : 0) });
    expect((await snapshot(s))!.session).toEqual(before.session);
    await advance(s, 2); await payout(s, 1);
    expect(await totals(owner!.id)).toMatchObject({ totalXp: 310, successfulPayouts: 2, receivedUsdtMinor: BigInt(currency === "USDT" ? 540 : 0) });
    expect((await readGrowthView(owner!.id)).records.filter(row => row.title.includes("出金"))).toHaveLength(2);
  });
  it("settles manual promotion once and blocks stale or unqualified requests", async () => {
    const { s, owner } = await create({ rules: propRules() });
    await expect(scoped(s, async () => confirmPropPromotion({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID() }))).rejects.toThrow();
    await advance(s, 3); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, true);
    expect((await snapshot(s))!.propAccount!.state.phase).toBe("EVALUATION");
    const input = { expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID() };
    const results = await Promise.all([scoped(s, () => confirmPropPromotion(input)), scoped(s, () => confirmPropPromotion(input))]);
    expect(results[0].id).toBe(results[1].id); expect(await totals(owner!.id)).toMatchObject({ totalXp: 105, passedEvaluations: 1 });
    await expect(scoped(s, () => confirmPropPromotion({ ...input, requestId: randomUUID() }))).rejects.toThrow();
    expect((await totals(owner!.id)).passedEvaluations).toBe(1);
  });
  it.each(["EVALUATION", "PAYOUT"])("rolls back original %s result when the growth write fails", async type => {
    const { s, owner } = type === "PAYOUT" ? await funded() : await create({ rules: propRules() });
    if (type === "EVALUATION") { await advance(s, 3); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, true); }
    const before = await snapshot(s), growth = await totals(owner!.id);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_prop_growth BEFORE INSERT ON UserGrowthFact WHEN NEW.type='${type}' BEGIN SELECT RAISE(ABORT,'growth failure'); END`);
    try {
      if (type === "PAYOUT") await expect(payout(s)).rejects.toThrow();
      else await expect(scoped(s, async () => confirmPropPromotion({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID() }))).rejects.toThrow();
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER fail_prop_growth"); }
    expect(await snapshot(s)).toEqual(before); expect(await totals(owner!.id)).toEqual(growth);
    if (type === "PAYOUT") expect(await prisma.propPracticePayout.count({ where: { replaySessionId: s.id } })).toBe(0);
  });
  it("keys rewards by session and round, preserving persisted deltas during rebuild", async () => {
    const { s, owner } = await create(); const other = await create({ owner });
    const input = { type: "EVALUATION" as const, sourceId: "promotion", occurredAt: new Date(), roundNumber: 1 };
    const receipts = await Promise.all([0, 1].map(() => sqliteWriteTransaction(prisma, tx => settleGrowth(tx, { ...input, sessionId: s.id }))));
    expect(receipts.filter(row => row?.awarded)).toHaveLength(1);
    await sqliteWriteTransaction(prisma, tx => settleGrowth(tx, { ...input, roundNumber: 2, sessionId: s.id }));
    await sqliteWriteTransaction(prisma, tx => settleGrowth(tx, { ...input, sessionId: other.s.id }));
    const key = sourceKey("EVALUATION", s.id, 1, "promotion");
    await prisma.userGrowthFact.update({ where: { sourceKey: key }, data: { ruleVersion: "legacy-rule", xpDelta: 17 } });
    expect(await sqliteWriteTransaction(prisma, tx => rebuildGrowth(tx, owner!.id))).toMatchObject({ totalXp: 217, passedEvaluations: 3 });
    const replay = await sqliteWriteTransaction(prisma, tx => settleGrowth(tx, { ...input, sessionId: s.id }));
    expect(replay).toMatchObject({ xp: 17, awarded: false });
  });
});

// Independent facts represent a test history; no threshold is lowered and no production API accepts deltas.
async function readyHistory(ownerId: string) {
  const r = FOUNDATION_REQUIREMENTS;
  await prisma.userGrowthFact.create({ data: { userId: ownerId, type: "CYCLE", sourceKey: randomUUID(), sessionId: "deleted-test-source", sourceSummary: "{}", occurredAt: new Date(), ruleVersion: "test-stored-history", xpDelta: r.totalXp, cyclesDelta: r.completedCycles, reviewsDelta: r.completedReviews, evaluationsDelta: r.passedEvaluations, payoutsDelta: r.successfulPayouts, receivedUsdtMinorDelta: r.receivedUsdtMinor } });
  await sqliteWriteTransaction(prisma, tx => rebuildGrowth(tx, ownerId));
}
describe("foundation achievement and bounded history", () => {
  it.each(Object.keys(FOUNDATION_REQUIREMENTS) as Array<keyof typeof FOUNDATION_REQUIREMENTS>)("rejects a one-unit %s deficit then attains once with no time gate", async key => {
    const owner = await user(); await readyHistory(owner.id);
    const missing = FOUNDATION_REQUIREMENTS[key];
    await prisma.userGrowth.update({ where: { userId: owner.id }, data: { [key]: typeof missing === "bigint" ? missing - BigInt(1) : missing - 1 } });
    await expect(breakthroughFoundation(owner.id)).rejects.toMatchObject({ code: "GROWTH_NOT_READY" });
    expect(await prisma.userRealmRecord.count({ where: { userId: owner.id } })).toBe(0);
    await sqliteWriteTransaction(prisma, tx => rebuildGrowth(tx, owner.id));
    const achieved = await Promise.all([breakthroughFoundation(owner.id), breakthroughFoundation(owner.id)]);
    expect(achieved[0].id).toBe(achieved[1].id); expect(achieved.filter(row => !row.repeated)).toHaveLength(1);
    expect(await totals(owner.id)).toMatchObject({ realm: "FOUNDATION", layer: 1, totalXp: 18100 });
    expect(await prisma.userGrowthFact.count({ where: { userId: owner.id, type: "BREAKTHROUGH" } })).toBe(1);
    const { s } = await create({ owner }); await cycle(s);
    expect(await totals(owner.id)).toMatchObject({ realm: "FOUNDATION", layer: 1, totalXp: 18105 });
    expect(await sqliteWriteTransaction(prisma, tx => rebuildGrowth(tx, owner.id))).toMatchObject({ realm: "FOUNDATION", layer: 1, totalXp: 18105 });
  });
  it("rejects client-supplied experience and preserves all state if breakthrough persistence fails", async () => {
    const owner = await user(); await readyHistory(owner.id); const context = { params: Promise.resolve({ userId: owner.id }) };
    expect((await breakthroughPOST(new Request("http://localhost/api/test", { method: "POST", body: JSON.stringify({ totalXp: 999999 }) }), context)).status).toBe(400);
    const before = await totals(owner.id);
    await prisma.$executeRawUnsafe("CREATE TRIGGER fail_attainment BEFORE INSERT ON UserGrowthFact WHEN NEW.type='BREAKTHROUGH' BEGIN SELECT RAISE(ABORT,'failure'); END");
    try { await expect(breakthroughFoundation(owner.id)).rejects.toThrow(); } finally { await prisma.$executeRawUnsafe("DROP TRIGGER fail_attainment"); }
    expect(await totals(owner.id)).toEqual(before); expect(await prisma.userRealmRecord.count({ where: { userId: owner.id } })).toBe(0);
    expect((await breakthroughPOST(new Request("http://localhost/api/test", { method: "POST", body: "{}" }), context)).status).toBe(200);
  });
  it("pages 5000 facts twenty at a time and fences new/backdated insertions without dropping history", async () => {
    const owner = await user(); const time = new Date();
    for (let batch = 0; batch < 10; batch++) await prisma.userGrowthFact.createMany({ data: Array.from({ length: 500 }, (_, index) => ({ userId: owner.id, type: "CYCLE", sourceKey: randomUUID(), sessionId: "deleted-source", sourceSummary: JSON.stringify({ sessionName: "保留来源" }), occurredAt: time, settledAt: new Date(time.getTime() + batch * 500 + index), ruleVersion: "test-v1", xpDelta: 5, cyclesDelta: 1 })) });
    const first = await readGrowthRecords(owner.id); expect(first.total).toBe(5000); expect(first.items).toHaveLength(20);
    await prisma.userGrowthFact.create({ data: { userId: owner.id, type: "CYCLE", sourceKey: randomUUID(), sessionId: "new", sourceSummary: "{}", occurredAt: time, settledAt: new Date(0), ruleVersion: "test-v1", xpDelta: 5 } });
    const last = await readGrowthRecords(owner.id, 9999, first.snapshot); expect(last).toMatchObject({ total: 5000, page: 250, pageSize: 20 }); expect(last.items).toHaveLength(20);
    expect((await readGrowthRecords(owner.id, 1, first.snapshot)).items).toEqual(first.items);
    expect((await readGrowthRecords(owner.id)).total).toBe(5001); expect(first.items.every(row => row.deleted && !row.sourceUrl)).toBe(true);
    expect((await readGrowthView(owner.id)).records).toHaveLength(5);
    const context = { params: Promise.resolve({ userId: owner.id }) };
    for (const query of ["page=0", "page=-1", "page=1.5", "snapshot=-1"]) expect((await recordsGET(new Request(`http://localhost/api/test?${query}`), context)).status).toBe(400);
  });
});

