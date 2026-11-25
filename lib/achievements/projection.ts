import type { Prisma, UserAchievementProgress } from "@prisma/client";
import { z } from "zod";
import { achievementCatalog, achievementKeys, isStreak, metricFingerprints, tierKey, type AchievementMetricKey, type MetricKey } from "./catalog";
import { scopeIdentity, type Evidence } from "./evidence";
import { ExitReason } from "./exit-evidence";

const milestoneSchema = z.record(z.object({ source: z.string(), at: z.string().datetime(), historical: z.boolean() }).strict());
type Milestones = z.infer<typeof milestoneSchema>;
const summaryScope = "";
type Cell = Pick<UserAchievementProgress, "current" | "best" | "coverageGaps"> & { milestones: Milestones };
export const metricIdentity = (userId: string, metricKey: MetricKey) => ({ userId, metricKey });
export const progressIdentity = (userId: string, metricKey: AchievementMetricKey, generation: string, scopeKey = summaryScope) =>
  ({ userId, metricKey, generation, scopeKey });
const emptyCell = (): Cell => ({ current: 0, best: 0, coverageGaps: 0, milestones: {} });

export function metricEvidence(metric: MetricKey, evidence: Evidence) {
  const { fact, mask } = evidence;
  const scope = scopeIdentity(fact);
  if (metric === "completed-cycles" && fact.type === "CYCLE") return { delta: fact.cyclesDelta };
  if (metric === "completed-reviews" && fact.type === "REVIEW") return { delta: fact.reviewsDelta };
  if (metric === "passed-evaluations" && fact.type === "EVALUATION") return { delta: fact.evaluationsDelta };
  if (metric === "successful-payouts" && fact.type === "PAYOUT") return { delta: fact.payoutsDelta };
  if (metric === "foundation" && fact.type === "BREAKTHROUGH") return { delta: 1 };
  if (metric === "payouts-in-round" && fact.type === "PAYOUT") return { delta: fact.payoutsDelta, scope: scope?.round ? scope.key : null };
  if (isStreak(metric) && fact.type === "CYCLE" && fact.cyclesDelta > 0) {
    const match = metric === "stop-loss-streak" ? ExitReason.STOP_LOSS : ExitReason.TAKE_PROFIT;
    const unknown = mask === null || mask === 0 || (mask & ExitReason.UNKNOWN) !== 0;
    return { delta: unknown ? 0 : Number(mask === match), scope: scope?.key ?? null, streak: true, unknown };
  }
  return null;
}

export function nextScope(current: number, match: number, streak: boolean) {
  return streak && match === 0 ? 0 : current + match;
}

/** Each batch reads and writes a touched cell once, irrespective of threshold count. */
export async function applyEvidence(
  tx: Prisma.TransactionClient, userId: string, metric: MetricKey, generation: string, rows: Evidence[],
) {
  const relevant = rows.flatMap(row => {
    const event = metricEvidence(metric, row);
    return event ? [{ ...event, row }] : [];
  });
  if (!relevant.length) return null;
  const scopeKeys = [...new Set([summaryScope, ...relevant.flatMap(row => row.scope || [])])];
  const existing = await tx.userAchievementProgress.findMany({ where: { userId, metricKey: metric, generation, scopeKey: { in: scopeKeys } } });
  const cells = new Map(scopeKeys.map(key => [key, emptyCell()]));
  for (const row of existing) cells.set(row.scopeKey, { ...row, milestones: milestoneSchema.parse(JSON.parse(row.milestones)) });
  const summary = cells.get(summaryScope)!;
  for (const event of relevant) {
    const priorBest = summary.best;
    if (!Number.isSafeInteger(event.delta) || event.delta < 0) throw new Error("ACHIEVEMENT_INVALID_DELTA");
    if (event.scope === null) summary.coverageGaps++;
    else if (event.scope) {
      const scope = cells.get(event.scope)!;
      scope.current = nextScope(scope.current, event.delta, !!event.streak);
      scope.best = Math.max(scope.best, scope.current);
      scope.coverageGaps += Number(!!event.unknown);
      summary.coverageGaps += Number(!!event.unknown);
      summary.best = Math.max(summary.best, scope.best);
    } else {
      summary.current += event.delta;
      summary.best = summary.current;
    }
    if (priorBest === summary.best) continue;
    for (const key of achievementKeys) {
      if (achievementCatalog[key].metric !== metric) continue;
      for (const threshold of achievementCatalog[key].thresholds as readonly number[]) {
        if (threshold <= priorBest || threshold > summary.best || summary.milestones[threshold]) continue;
        const fact = event.row.fact;
        summary.milestones[threshold] = {
          source: fact.id,
          at: (metric === "foundation" ? fact.occurredAt : fact.settledAt).toISOString(),
          historical: event.row.historical,
        };
      }
    }
  }
  for (const [scopeKey, cell] of cells) {
    const identity = progressIdentity(userId, metric, generation, scopeKey);
    const data = { current: cell.current, best: cell.best, coverageGaps: cell.coverageGaps, milestones: JSON.stringify(cell.milestones) };
    await tx.userAchievementProgress.upsert({ where: { userId_metricKey_generation_scopeKey: identity }, create: { ...identity, ...data }, update: data });
  }
  return summary;
}

export async function metricSummary(tx: Prisma.TransactionClient, userId: string, metric: MetricKey, generation: string) {
  const row = await tx.userAchievementProgress.findUnique({
    where: { userId_metricKey_generation_scopeKey: progressIdentity(userId, metric, generation) },
  });
  return row ? { ...row, milestones: milestoneSchema.parse(JSON.parse(row.milestones)) } : emptyCell();
}

type Award = Prisma.UserAchievementCreateManyInput & { attainedAt: Date | null; growthFactId: string | null };

export function qualifyingAwards(userId: string, metric: MetricKey, summary: Cell, historicalPublication = false): Award[] {
  return achievementKeys.flatMap(achievementKey => {
    const entry = achievementCatalog[achievementKey];
    if (entry.metric !== metric) return [];
    return (entry.thresholds as readonly number[]).flatMap((threshold, index) => {
      if (threshold > summary.best) return [];
      const source = summary.milestones[threshold];
      return [{
        userId, achievementKey, tierKey: tierKey(index), threshold, fingerprint: metricFingerprints[metric],
        attainedAt: source ? new Date(source.at) : null,
        historical: historicalPublication || (source?.historical ?? true), growthFactId: source?.source ?? null,
      }];
    });
  });
}

export async function publishAwards(tx: Prisma.TransactionClient, awards: Award[], reconcileAttainment = false) {
  if (!awards.length) return 0;
  // SQLite createMany does not support skipDuplicates.
  const existing = await tx.userAchievement.findMany({ where: {
    userId: awards[0].userId, achievementKey: { in: [...new Set(awards.map(row => row.achievementKey))] },
  }, select: { seq: true, achievementKey: true, tierKey: true, threshold: true, fingerprint: true, attainedAt: true } });
  const known = new Map(existing.map(row => [row.achievementKey + "/" + row.tierKey, row]));
  const pending = [];
  for (const award of awards) {
    const row = known.get(award.achievementKey + "/" + award.tierKey);
    if (!row) {
      pending.push(award);
    } else if (reconcileAttainment && award.attainedAt && award.growthFactId
      && row.threshold === award.threshold && row.fingerprint === award.fingerprint
      && (!row.attainedAt || award.attainedAt < row.attainedAt)) {
      await tx.userAchievement.update({
        where: { seq: row.seq }, data: { attainedAt: award.attainedAt, growthFactId: award.growthFactId },
      });
    }
  }
  if (pending.length) await tx.userAchievement.createMany({ data: pending });
  return pending.length;
}
