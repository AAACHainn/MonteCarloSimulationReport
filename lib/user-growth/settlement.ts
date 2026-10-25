import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { getReplayScope, ReplaySessionError } from "@/lib/replay-sessions/scope";
import { logicalId } from "@/lib/replay-sessions/identity";
import { emptyGrowthTotals, foundationReady, growthRealm, GROWTH_RULE_VERSION, GROWTH_XP, receivedUsdtMinor, type GrowthTotals } from "./rules";

export type GrowthFactType = "CYCLE" | "REVIEW" | "EVALUATION" | "PAYOUT";
export type GrowthSource = { sessionName: string; datasetId: string; datasetName: string; symbol: string; sequence?: number; entryKey?: string; entryNo?: number; journalSessionId?: string; currency?: string };
export type GrowthReceipt = { userId: string; nickname: string; xp: number; awarded: boolean };
export const sourceKey = (type: GrowthFactType, sessionId: string, round: number, sourceId: string) => `${type}:${JSON.stringify([sessionId, round, logicalId(sourceId)])}`;

/** Called only inside the original business transaction, never by a client reward request. */
export async function settleGrowth(tx: Prisma.TransactionClient, input: {
  type: GrowthFactType; sourceId: string; roundNumber?: number; occurredAt: Date; sessionId?: string;
  source?: Partial<Pick<GrowthSource, "sequence" | "entryKey" | "entryNo" | "journalSessionId" | "currency">>;
  payout?: { received: number; currency: string; firstInRound: boolean };
}): Promise<GrowthReceipt | null> {
  const sessionId = input.sessionId ?? getReplayScope()?.id;
  if (!sessionId) return null;
  const session = await tx.replaySession.findUnique({ where: { id: sessionId }, include: { dataset: { select: { name: true, symbol: true } }, user: { select: { nickname: true } } } });
  if (!session?.userId || !session.user || !session.growthEligible || session.ownershipSource !== "CREATED" || session.mode !== "TRAINING") return null;
  const round = input.roundNumber ?? 0;
  const key = sourceKey(input.type, session.id, round, input.sourceId);
  const existing = await tx.userGrowthFact.findUnique({ where: { sourceKey: key } });
  if (existing) return { userId: existing.userId, nickname: session.user.nickname, xp: existing.xpDelta, awarded: false };
  const firstKey = input.type === "PAYOUT" && input.payout?.firstInRound ? `FIRST_PAYOUT:${JSON.stringify([session.id, round])}` : null;
  const first = firstKey && !await tx.userGrowthFact.findUnique({ where: { firstPayoutKey: firstKey } });
  const delta = { ...emptyGrowthTotals(), totalXp: input.type === "PAYOUT" ? first ? GROWTH_XP.PAYOUT_FIRST : 0 : GROWTH_XP[input.type],
    completedCycles: input.type === "CYCLE" ? 1 : 0, completedReviews: input.type === "REVIEW" ? 1 : 0,
    passedEvaluations: input.type === "EVALUATION" ? 1 : 0, successfulPayouts: input.type === "PAYOUT" ? 1 : 0,
    receivedUsdtMinor: input.type === "PAYOUT" && input.payout?.currency === "USDT" ? receivedUsdtMinor(input.payout.received) : BigInt(0) };
  const summary: GrowthSource = { sessionName: session.name, datasetId: session.datasetId, datasetName: session.dataset.name, symbol: session.dataset.symbol, ...input.source };
  await tx.userGrowthFact.create({ data: { userId: session.userId, type: input.type, sourceKey: key, firstPayoutKey: first ? firstKey : null,
    sessionId: session.id, roundNumber: round, sourceSummary: JSON.stringify(summary), occurredAt: input.occurredAt,
    ruleVersion: GROWTH_RULE_VERSION, xpDelta: delta.totalXp, cyclesDelta: delta.completedCycles, reviewsDelta: delta.completedReviews,
    evaluationsDelta: delta.passedEvaluations, payoutsDelta: delta.successfulPayouts, receivedUsdtMinorDelta: delta.receivedUsdtMinor } });
  const current = await tx.userGrowth.upsert({ where: { userId: session.userId }, create: { userId: session.userId }, update: {} });
  const totals: GrowthTotals = { totalXp: current.totalXp + delta.totalXp, completedCycles: current.completedCycles + delta.completedCycles,
    completedReviews: current.completedReviews + delta.completedReviews, passedEvaluations: current.passedEvaluations + delta.passedEvaluations,
    successfulPayouts: current.successfulPayouts + delta.successfulPayouts, receivedUsdtMinor: current.receivedUsdtMinor + delta.receivedUsdtMinor };
  if (Object.entries(totals).some(([, value]) => typeof value === "number" && !Number.isSafeInteger(value))) throw new Error("Growth accumulation exceeds supported range");
  await tx.userGrowth.update({ where: { userId: session.userId }, data: { ...totals, ...growthRealm(totals.totalXp, current.realm === "FOUNDATION"), version: { increment: 1 } } });
  return { userId: session.userId, nickname: session.user.nickname, xp: delta.totalXp, awarded: true };
}

export async function settleClosedCycle(tx: Prisma.TransactionClient, trade: { id: string; closedAt: Date | null; closedSequence: number | null }) {
  const scope = getReplayScope();
  if (!scope || scope.mode !== "TRAINING" || !trade.closedAt) return;
  const round = scope.accountCategory === "PROP_PRACTICE" ? await tx.propPracticeRound.findUnique({ where: { projectionId: scope.projectionId }, select: { number: true } }) : null;
  await settleGrowth(tx, { type: "CYCLE", sourceId: logicalId(trade.id), roundNumber: round?.number ?? 0, occurredAt: trade.closedAt,
    source: { sequence: trade.closedSequence ?? undefined } });
}

/** Administrative rebuild helper: historical stored deltas, never current prices/rules/surviving sources. */
export async function rebuildGrowth(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.userGrowthFact.aggregate({ where: { userId }, _sum: { xpDelta: true, cyclesDelta: true, reviewsDelta: true, evaluationsDelta: true, payoutsDelta: true, receivedUsdtMinorDelta: true } });
  const sum = rows._sum;
  const totals: GrowthTotals = { totalXp: sum.xpDelta ?? 0, completedCycles: sum.cyclesDelta ?? 0, completedReviews: sum.reviewsDelta ?? 0,
    passedEvaluations: sum.evaluationsDelta ?? 0, successfulPayouts: sum.payoutsDelta ?? 0, receivedUsdtMinor: sum.receivedUsdtMinorDelta ?? BigInt(0) };
  const attained = await tx.userRealmRecord.findUnique({ where: { userId_toRealm: { userId, toRealm: "FOUNDATION" } } });
  return tx.userGrowth.upsert({ where: { userId }, create: { userId, ...totals, ...growthRealm(totals.totalXp, !!attained) }, update: { ...totals, ...growthRealm(totals.totalXp, !!attained), version: { increment: 1 } } });
}

export async function breakthroughFoundation(userId: string) {
  return sqliteWriteTransaction(prisma, async tx => {
    const existing = await tx.userRealmRecord.findUnique({ where: { userId_toRealm: { userId, toRealm: "FOUNDATION" } } });
    if (existing) return { id: existing.id, attainedAt: existing.attainedAt, repeated: true };
    const totals = await tx.userGrowth.findUnique({ where: { userId } });
    if (!totals) throw new ReplaySessionError("USER_NOT_FOUND", 404, copy.userGrowth.userMissing);
    if (!foundationReady(totals)) throw new ReplaySessionError("GROWTH_NOT_READY", 409, copy.userGrowth.breakthroughNotReady);
    const record = await tx.userRealmRecord.create({ data: { userId, fromRealm: "QI", toRealm: "FOUNDATION", idempotencyKey: `foundation:${userId}`,
      ruleVersion: GROWTH_RULE_VERSION, metricsSnapshot: JSON.stringify({ ...totals, receivedUsdtMinor: totals.receivedUsdtMinor.toString() }) } });
    await tx.userGrowth.update({ where: { userId }, data: { realm: "FOUNDATION", layer: 1, version: { increment: 1 } } });
    // Independent achievement source; no session foreign key and no extra experience reward.
    await tx.userGrowthFact.create({ data: { userId, type: "BREAKTHROUGH", sourceKey: `foundation:${userId}`, sessionId: "", sourceSummary: JSON.stringify({ sessionName: copy.userGrowth.recordBreakthrough }),
      occurredAt: record.attainedAt, ruleVersion: GROWTH_RULE_VERSION } });
    return { id: record.id, attainedAt: record.attainedAt, repeated: false };
  });
}
