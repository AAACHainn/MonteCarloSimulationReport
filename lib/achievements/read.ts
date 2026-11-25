import { Prisma, type UserAchievement } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { replayJournalTradeHref } from "@/lib/paper-trading/journal-links";
import { projectionRecordId } from "@/lib/replay-sessions/identity";
import { readUserFundsMinor } from "@/lib/user-wallet/balances";
import { achievementCatalog, achievementKeys, achievementStageCount, catalogVersion, fundsMetric, isStreak, metricFingerprints, metricKeys, tierKey, type AchievementKey, type MetricKey } from "./catalog";
import { factSelect, scopeIdentity, sourceProjectionId } from "./evidence";
import { readFundMilestones } from "./funds";
import { AchievementError, canDiscardPlan } from "./jobs";

export const showcaseInput = z.object({ series: z.array(z.enum(achievementKeys)).max(3).refine(keys => new Set(keys).size === keys.length) }).strict();
const sourceSchema = z.object({
  sessionName: z.string().max(300).optional(), symbol: z.string().max(100).optional(),
  journalSessionId: z.string().optional(), entryNo: z.number().int().positive().optional(), entryKey: z.string().optional(),
});
const publicAward = (row: UserAchievement) => ({
  seq: row.seq, key: row.achievementKey as AchievementKey, tier: row.tierKey, threshold: row.threshold, fingerprint: row.fingerprint,
  attainedAt: row.attainedAt?.toISOString() ?? null, recordedAt: row.recordedAt.toISOString(), historical: row.historical,
});

async function bestActiveScope(tx: Prisma.TransactionClient, userId: string, metric: MetricKey, generation: string, focusSession?: string) {
  return (await tx.$queryRaw<Array<{ current: number; scopeKey: string; name: string }>>`
    SELECT p."current", p."scopeKey", s."name"
    FROM "UserAchievementProgress" p
    JOIN "ReplaySession" s ON s."id" = json_extract(NULLIF(p."scopeKey", ''), '$[0]')
    LEFT JOIN "PropPracticeAccount" account ON account."replaySessionId" = s."id"
    WHERE p."userId" = ${userId} AND p."metricKey" = ${metric} AND p."generation" = ${generation}
      AND s."userId" = ${userId} AND s."status" = 'ACTIVE'
      AND json_extract(p."scopeKey", '$[1]') = COALESCE(account."roundNumber", 0)
      ${focusSession ? Prisma.sql`AND s."id" = ${focusSession}` : Prisma.empty}
    ORDER BY p."current" DESC LIMIT 1`)[0];
}

async function requireUser(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.userProfile.findUnique({ where: { id: userId }, select: { id: true, nickname: true } });
  if (!user) throw new AchievementError("USER_NOT_FOUND", 404);
  return user;
}

export async function readAchievements(userId: string, focusSession?: string) {
  return prisma.$transaction(async tx => {
    const user = await requireUser(tx, userId);
    const activeGenerations = await tx.userAchievementState.findMany({ where: { userId, metricKey: { in: metricKeys } } });
    const [progress, awards, showcase, pending, slot, legacy, fundsBalance, fundProgress] = await Promise.all([
      activeGenerations.length ? tx.userAchievementProgress.findMany({ where: {
        userId, scopeKey: "", OR: activeGenerations.map(({ metricKey, generation }) => ({ metricKey, generation })),
      } }) : [],
      tx.userAchievement.findMany({ where: { userId, achievementKey: { in: achievementKeys } }, orderBy: { seq: "desc" } }),
      tx.userAchievementShowcase.findMany({ where: { userId }, orderBy: { slot: "asc" } }),
      tx.achievementJob.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] }, OR: [{ userId }, { userId: null, userWatermark: { gte: userId } }] }, select: { id: true } }),
      tx.achievementSyncState.findUnique({ where: { id: 1 }, select: { liveError: true } }),
      tx.userGrowthFact.findFirst({ where: { userId, achievementCaptureVersion: 0 }, select: { id: true } }),
      readUserFundsMinor(tx, userId),
      readFundMilestones(tx, userId),
    ]);
    const items = await Promise.all(achievementKeys.map(async key => {
      const spec = achievementCatalog[key];
      const metric = spec.metric;
      const state = activeGenerations.find(item => item.metricKey === metric);
      const row = progress.find(item => item.metricKey === spec.metric);
      const match = awards.filter(award => award.achievementKey === key).map(publicAward);
      const streak = metric !== fundsMetric && isStreak(metric);
      const focused = streak && state && focusSession ? await bestActiveScope(tx, userId, metric, state.generation, focusSession) : undefined;
      const scope = focused ?? (streak && state ? await bestActiveScope(tx, userId, metric, state.generation) : undefined);
      const located = scope ? z.tuple([z.string(), z.number()]).parse(JSON.parse(scope.scopeKey)) : undefined;
      const tiers = (spec.thresholds as readonly number[]).map((threshold, index) => ({ target: threshold, key: tierKey(index), award: match.find(item => item.tier === tierKey(index)) ?? null }));
      const highest = tiers.findLastIndex(tier => tier.award) + 1;
      const funds = metric === fundsMetric;
      const current = funds ? Number(fundsBalance ?? 0) : streak ? scope?.current ?? 0 : row?.best ?? 0;
      const best = funds ? fundProgress?.best ?? 0 : row?.best ?? 0;
      const status = highest ? "unlocked" as const : (funds ? current : best) > 0 ? "inProgress" as const : "locked" as const;
      return {
        key, category: spec.category, highest, status, tiers,
        current, best, streak,
        scope: located && scope ? { name: scope.name, round: located[1], focused: !!focused } : null,
        gap: !!row?.coverageGaps,
        historyPending: funds ? fundsBalance !== null && !fundProgress : !!legacy && !state?.historyChecked,
        outdated: metric !== fundsMetric && !!state && state.fingerprint !== metricFingerprints[metric],
      };
    }));
    return { user, version: catalogVersion, items, totalStages: achievementStageCount, unlockedStages: items.reduce((sum, item) => sum + item.tiers.filter(tier => tier.award).length, 0),
      latest: awards[0] ? publicAward(awards[0]) : null, showcase: showcase.flatMap(row => {
        const series = items.find(item => item.key === row.achievementKey);
        return series?.highest ? [{ key: series.key, tier: series.highest }] : [];
      }), syncing: !!pending, error: slot?.liveError ?? null };
  });
}

export async function readAchievementDetail(userId: string, key: AchievementKey) {
  return prisma.$transaction(async tx => {
    await requireUser(tx, userId);
    const rows = await tx.userAchievement.findMany({ where: { userId, achievementKey: key }, orderBy: { tierKey: "asc" }, take: 20 });
    return Promise.all(rows.map(async row => {
      const award = publicAward(row);
      const fact = row.growthFactId ? await tx.userGrowthFact.findUnique({ where: { id: row.growthFactId }, select: { ...factSelect, sourceSummary: true } }) : null;
      if (!fact || fact.userId !== userId || fact.type === "BREAKTHROUGH") return { ...award, source: null };
      let stored: z.infer<typeof sourceSchema> = {};
      try { stored = sourceSchema.parse(JSON.parse(fact.sourceSummary)); } catch { /* Older summaries may omit fields. */ }
      const session = await tx.replaySession.findUnique({
        where: { id: fact.sessionId }, select: { id: true, userId: true, datasetId: true, accountCategory: true, activeProjectionId: true },
      });
      const identity = scopeIdentity(fact);
      let href: string | null = null;
      if (session?.userId === userId && identity) {
        if (fact.type === "REVIEW" && stored.journalSessionId && stored.entryNo) {
          const entry = await tx.replayJournalEntry.findFirst({ where: {
            journalSessionId: stored.journalSessionId, no: stored.entryNo, logicalKey: identity.sourceId,
            journalSession: { replaySessionId: fact.sessionId },
          }, select: { id: true } });
          if (entry) href = replayJournalTradeHref(session.datasetId, stored.journalSessionId, stored.entryNo);
        } else if (fact.type !== "REVIEW") {
          const projection = await sourceProjectionId(tx, session, identity.round);
          const exists = fact.type === "CYCLE" && projection
            ? await tx.paperTrade.findFirst({ where: { id: projectionRecordId(projection, identity.sourceId), session: { projectionId: projection } } })
            : fact.type === "PAYOUT" && projection
              ? await tx.propPracticePayout.findFirst({ where: { id: identity.sourceId, replaySessionId: session.id, roundNumber: identity.round } })
              : fact.type === "EVALUATION" && projection;
          if (exists) {
            const round = session.accountCategory === "PROP_PRACTICE" ? `&propRound=${identity.round}` : "";
            href = `/market-replay/${encodeURIComponent(session.datasetId)}/trade-history?sessionId=${encodeURIComponent(fact.sessionId)}${round}`;
          }
        }
      }
      return { ...award, source: { name: stored.sessionName ?? null, symbol: stored.symbol ?? null, href, round: fact.roundNumber, replayAt: fact.occurredAt.toISOString() } };
    }));
  });
}

export async function saveShowcase(userId: string, keys: AchievementKey[]) {
  return sqliteWriteTransaction(prisma, async tx => {
    await requireUser(tx, userId);
    const eligible = await tx.userAchievement.findMany({ where: { userId, achievementKey: { in: keys } }, distinct: ["achievementKey"], select: { achievementKey: true } });
    if (eligible.length !== keys.length) throw new AchievementError("SHOWCASE_LOCKED", 409);
    await tx.userAchievementShowcase.deleteMany({ where: { userId } });
    if (keys.length) await tx.userAchievementShowcase.createMany({ data: keys.map((achievementKey, index) => ({ userId, achievementKey, slot: index + 1 })) });
    return keys;
  });
}

export async function readAchievementNotifications(userId: string, after?: number) {
  return prisma.$transaction(async tx => {
    const user = await requireUser(tx, userId);
    const [latest, count, historical] = await Promise.all([
      tx.userAchievement.findFirst({ where: { userId }, orderBy: { seq: "desc" }, select: { seq: true } }),
      after !== undefined ? tx.userAchievement.count({ where: { userId, seq: { gt: after } } }) : 0,
      after !== undefined ? tx.userAchievement.count({ where: { userId, seq: { gt: after }, historical: true } }) : 0,
    ]);
    return { user, latest: latest?.seq ?? 0, count, historical };
  });
}

export async function readAchievementMaintenance(before?: string) {
  const [slot, jobs, counts] = await Promise.all([
    prisma.achievementSyncState.findUnique({ where: { id: 1 }, select: { enabledAt: true, lastSyncedAt: true, liveError: true, retryAt: true } }),
    prisma.achievementJob.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, ...(before ? { cursor: { id: before }, skip: 1 } : {}) }),
    prisma.achievementJob.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  if (!slot) throw new Error("ACHIEVEMENT_SCHEMA_NOT_READY");
  return { slot, version: catalogVersion, jobs: jobs.slice(0, 20), counts: Object.fromEntries(counts.map(item => [item.status, item._count._all])), next: jobs.length > 20 ? jobs[19].id : null };
}

export async function readAchievementJob(id: string, after?: string) {
  const [job, rows] = await Promise.all([
    prisma.achievementJob.findUnique({ where: { id } }),
    prisma.achievementJobItem.findMany({ where: { jobId: id, ...(after ? { userId: { gt: after } } : {}) }, orderBy: { userId: "asc" }, take: 21,
      select: { userId: true, status: true, phase: true } }),
  ]);
  if (!job) throw new AchievementError("JOB_NOT_FOUND", 404);
  return { job, canDiscard: canDiscardPlan(job), items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].userId : null };
}
