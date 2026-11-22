import { Prisma, type AchievementFact } from "@prisma/client";
import { z } from "zod";
import { projectionRecordId } from "@/lib/replay-sessions/identity";
import { ExitReason, reconcileExitMask, verifiedExitMask } from "./exit-evidence";

export const factSelect = {
  id: true, userId: true, type: true, sessionId: true, roundNumber: true, sourceKey: true,
  occurredAt: true, settledAt: true, cyclesDelta: true, reviewsDelta: true, evaluationsDelta: true, payoutsDelta: true,
} satisfies Prisma.UserGrowthFactSelect;
export type GrowthEvidence = Prisma.UserGrowthFactGetPayload<{ select: typeof factSelect }>;
export type Evidence = { fact: GrowthEvidence; seq: number; mask: number | null; historical: boolean };
const identity = z.tuple([z.string(), z.number().int().nonnegative(), z.string().min(1)]);

export function scopeIdentity(fact: GrowthEvidence) {
  if (!fact.sessionId || fact.roundNumber === null || fact.roundNumber < 0) return null;
  const prefix = fact.type + ":";
  if (!fact.sourceKey.startsWith(prefix)) return null;
  try {
    const parsed = identity.safeParse(JSON.parse(fact.sourceKey.slice(prefix.length)));
    if (parsed.success && parsed.data[0] === fact.sessionId && parsed.data[1] === fact.roundNumber) {
      return { sessionId: fact.sessionId, round: fact.roundNumber, sourceId: parsed.data[2], key: JSON.stringify(parsed.data.slice(0, 2)) };
    }
  } catch { /* Invalid evidence cannot establish a scope. */ }
  return null;
}

export async function indexedEvidence(tx: Prisma.TransactionClient, indexes: AchievementFact[]): Promise<Evidence[]> {
  if (!indexes.length) return [];
  const rows = await tx.userGrowthFact.findMany({ where: { id: { in: indexes.map(row => row.growthFactId) } }, select: factSelect });
  const byId = new Map(rows.map(row => [row.id, row]));
  return indexes.map(index => {
    const fact = byId.get(index.growthFactId);
    if (!fact || fact.userId !== index.userId) throw new Error("ACHIEVEMENT_SOURCE_MISMATCH");
    return { fact, seq: index.seq, mask: index.exitReasonMask, historical: false };
  });
}

// Live rows are excluded even when their settlement time ties the last old row.
// The legacy partition is immutable after release, so the composite key is safe
// across restarts, deletions of replay data, and VACUUM.
export async function legacyEvidence(tx: Prisma.TransactionClient, input: {
  userId: string; id: string; streak: boolean; limit: number;
}) {
  const clock = input.streak ? Prisma.raw('"occurredAt"') : Prisma.raw('"settledAt"');
  const ids = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT g."id" FROM "UserGrowthFact" g
    WHERE g."userId" = ${input.userId} AND g."achievementCaptureVersion" = 0
      ${input.streak ? Prisma.sql`AND g."type" = 'CYCLE'` : Prisma.empty}
      ${input.id ? Prisma.sql`AND (${clock}, g."id") > ((SELECT ${clock} FROM "UserGrowthFact" WHERE "id" = ${input.id}), ${input.id})` : Prisma.empty}
    ORDER BY ${clock}, g."id" LIMIT ${input.limit}`;
  if (!ids.length) return [];
  const rows = await tx.userGrowthFact.findMany({ where: { id: { in: ids.map(row => row.id) } }, select: factSelect });
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(({ id }) => byId.get(id)!);
}

export async function sourceProjectionId(tx: Prisma.TransactionClient, session: { id: string; accountCategory: string; activeProjectionId: string | null }, round: number) {
  if (session.accountCategory !== "PROP_PRACTICE") return round === 0 ? session.activeProjectionId : null;
  if (round < 1) return null;
  const match = await tx.propPracticeRound.findUnique({
    where: { replaySessionId_number: { replaySessionId: session.id, number: round } }, select: { projectionId: true },
  });
  return match?.projectionId ?? null;
}

export async function historicalExit(tx: Prisma.TransactionClient, fact: GrowthEvidence, ordered = false): Promise<number> {
  const scope = scopeIdentity(fact);
  if (!scope?.sourceId.startsWith("speculative_")) return ExitReason.UNKNOWN;
  const session = await tx.replaySession.findUnique({
    where: { id: scope.sessionId }, select: { id: true, userId: true, growthEligible: true, mode: true, accountCategory: true, activeProjectionId: true },
  });
  if (!session || session.userId !== fact.userId || !session.growthEligible || session.mode !== "TRAINING") return ExitReason.UNKNOWN;
  const projectionId = await sourceProjectionId(tx, session, scope.round);
  if (!projectionId) return ExitReason.UNKNOWN;
  // No legacy within-candle execution ordinal was persisted. Equal close times
  // in this scope are an explicit gap, even if one trade has been deleted.
  if (!ordered) {
    const tied = await tx.userGrowthFact.findFirst({ where: {
      userId: fact.userId, type: "CYCLE", occurredAt: fact.occurredAt, sessionId: fact.sessionId, roundNumber: fact.roundNumber, id: { not: fact.id },
    }, select: { id: true } });
    if (tied) return ExitReason.UNKNOWN;
  }
  const trade = await tx.paperTrade.findUnique({
    where: { id: projectionRecordId(projectionId, scope.sourceId) },
    select: { id: true, openedSequence: true, openedAt: true, side: true, closedSequence: true, closedAt: true, sessionId: true, status: true, session: { select: { projectionId: true } } },
  });
  if (trade?.status !== "CLOSED" || trade.session.projectionId !== projectionId || trade.closedSequence === null
    || trade.closedAt?.getTime() !== fact.occurredAt.getTime()) return ExitReason.UNKNOWN;
  return await verifiedExitMask(tx, trade, 0, trade.closedSequence) || ExitReason.UNKNOWN;
}

export async function recheckIndexedExits(tx: Prisma.TransactionClient, evidence: Evidence[]) {
  let checked = 0;
  for (const [index, row] of evidence.entries()) {
    const { fact, mask } = row;
    if (fact.type !== "CYCLE" || fact.cyclesDelta <= 0 || (mask && !(mask & ExitReason.UNKNOWN))) continue;
    if (checked === 4) return evidence.slice(0, index);
    row.mask = reconcileExitMask(mask, await historicalExit(tx, fact, true));
    checked++;
  }
  return evidence;
}

export async function verifyFoundation(tx: Prisma.TransactionClient, fact: GrowthEvidence) {
  if (fact.type !== "BREAKTHROUGH") return;
  const record = await tx.userRealmRecord.findUnique({
    where: { userId_toRealm: { userId: fact.userId, toRealm: "FOUNDATION" } }, select: { idempotencyKey: true, attainedAt: true },
  });
  if (!record || record.idempotencyKey !== fact.sourceKey || record.attainedAt.getTime() !== fact.occurredAt.getTime()) {
    throw new Error("ACHIEVEMENT_INVALID_BREAKTHROUGH");
  }
}
