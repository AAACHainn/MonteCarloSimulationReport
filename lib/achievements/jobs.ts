import type { AchievementJob, AchievementJobItem, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { isStreak, metricFingerprints, metricKeys, metricPlanFingerprint, type MetricKey } from "./catalog";
import { historicalExit, indexedEvidence, legacyEvidence, recheckIndexedExits, verifyFoundation, type Evidence } from "./evidence";
import { applyEvidence, metricIdentity, metricSummary, publishAwards, qualifyingAwards } from "./projection";
import { wakeAchievements } from "./wake";

const metricSchema = z.enum(metricKeys);
const metricsSchema = z.array(metricSchema).min(1).max(metricKeys.length);
const retiredSchema = z.record(z.string());
export const previewInput = z.object({
  userId: z.string().min(1).max(128).nullable(),
  metrics: metricsSchema,
  mode: z.enum(["BACKFILL", "RECHECK"]),
}).strict();
export const jobInput = z.object({ planId: z.string().min(1).max(128) }).strict();
export const runnableJobs = ["PREVIEW", "QUEUED", "RUNNING", "DISCARDING"];

export class AchievementError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

function currentPlanMetrics(job: AchievementJob) {
  try {
    const parsed = metricsSchema.safeParse(JSON.parse(job.metrics));
    if (parsed.success && job.fingerprint === metricPlanFingerprint(parsed.data)) return parsed.data;
  } catch { /* A plan with an unreadable metric list cannot be started. */ }
  return null;
}

function jobMetrics(job: AchievementJob) {
  const metrics = currentPlanMetrics(job);
  if (!metrics) throw new AchievementError("PLAN_EXPIRED", 409);
  return metrics;
}

export function canDiscardPlan(job: AchievementJob) {
  if (job.status === "PREVIEW" || job.status === "READY") return true;
  return job.status === "FAILED" && job.phase !== "DISCARD" && job.error !== "COMMIT_UNVERIFIED"
    && (job.phase === "DISCOVER" || job.phase === "PREVIEW" || !currentPlanMetrics(job));
}

async function queueDiscard(tx: Prisma.TransactionClient, id: string) {
  return tx.achievementJob.update({ where: { id }, data: {
    status: "DISCARDING", phase: "DISCARD", userCursor: "", attempts: 0, error: null, retryAt: null,
  } });
}

export async function createAchievementPreview(input: z.infer<typeof previewInput>) {
  const metrics = metricKeys.filter(metric => input.metrics.includes(metric));
  const fingerprint = metricPlanFingerprint(metrics);
  const job = await sqliteWriteTransaction(prisma, async tx => {
    const where = {
      status: { in: ["PREVIEW", "READY", "QUEUED", "RUNNING", "FAILED"] },
      phase: { not: "DISCARD" },
      AND: [
        ...(input.userId ? [{ OR: [{ userId: input.userId }, { userId: null }] }] : []),
        { OR: metrics.map(metric => ({ metrics: { contains: JSON.stringify(metric) } })) },
      ],
    };
    // One staged generation per user and metric. Overlap includes all-user plans.
    // Expire obsolete plans in bounded batches when they would block a new plan.
    const overlaps = await tx.achievementJob.findMany({ where, orderBy: { createdAt: "asc" }, take: 11 });
    for (const overlap of overlaps.slice(0, 10)) {
      if (overlap.userId === input.userId && overlap.mode === input.mode && overlap.fingerprint === fingerprint) return overlap;
      if (currentPlanMetrics(overlap) || !canDiscardPlan(overlap)) return null;
      await queueDiscard(tx, overlap.id);
    }
    if (overlaps.length > 10) return null;
    const lastUser = await tx.userProfile.findFirst({ where: input.userId ? { id: input.userId } : {}, orderBy: { id: "desc" }, select: { id: true } });
    if (input.userId && !lastUser) throw new AchievementError("USER_NOT_FOUND", 404);
    const lastFact = await tx.achievementFact.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
    return tx.achievementJob.create({ data: {
      userId: input.userId, metrics: JSON.stringify(metrics), fingerprint, mode: input.mode,
      userWatermark: lastUser?.id ?? "", liveWatermark: lastFact?.seq ?? 0,
    } });
  });
  wakeAchievements();
  if (!job) throw new AchievementError("JOB_CONFLICT", 409);
  return job;
}

export async function discardAchievementPreview(id: string) {
  const job = await sqliteWriteTransaction(prisma, async tx => {
    const row = await tx.achievementJob.findUnique({ where: { id } });
    if (!row) throw new AchievementError("JOB_NOT_FOUND", 404);
    if (row.status === "DISCARDING" || row.status === "DISCARDED") return row;
    if (!canDiscardPlan(row)) throw new AchievementError("PLAN_NOT_DISCARDABLE", 409);
    return queueDiscard(tx, id);
  });
  wakeAchievements();
  return job;
}

export async function startAchievementJob(id: string) {
  const job = await sqliteWriteTransaction(prisma, async tx => {
    const row = await tx.achievementJob.findUnique({ where: { id } });
    if (!row) throw new AchievementError("JOB_NOT_FOUND", 404);
    jobMetrics(row);
    if (["QUEUED", "RUNNING", "SUCCEEDED"].includes(row.status)) return row;
    if (row.status !== "READY") throw new AchievementError("PLAN_NOT_READY", 409);
    return tx.achievementJob.update({ where: { id }, data: { status: "QUEUED", phase: "CATCH_UP", error: null } });
  });
  wakeAchievements();
  return job;
}

export async function retryAchievementJob(id: string) {
  const job = await sqliteWriteTransaction(prisma, async tx => {
    const row = await tx.achievementJob.findUnique({ where: { id } });
    if (!row) throw new AchievementError("JOB_NOT_FOUND", 404);
    if (runnableJobs.includes(row.status)) return row;
    if (row.status !== "FAILED") throw new AchievementError("PLAN_NOT_READY", 409);
    if (row.error === "COMMIT_UNVERIFIED") throw new AchievementError("COMMIT_UNVERIFIED", 409);
    if (row.phase === "DISCARD") {
      return tx.achievementJob.update({ where: { id }, data: { status: "DISCARDING", attempts: 0, error: null, retryAt: null } });
    }
    jobMetrics(row);
    const preview = row.phase === "DISCOVER" || row.phase === "PREVIEW";
    return tx.achievementJob.update({ where: { id }, data: { status: preview ? "PREVIEW" : "QUEUED", attempts: 0, error: null, retryAt: null } });
  });
  wakeAchievements();
  return job;
}

export async function retryAchievementQueue() {
  await sqliteWriteTransaction(prisma, async tx => {
    const slot = await tx.achievementSyncState.findUniqueOrThrow({ where: { id: 1 } });
    if (slot.liveError === "COMMIT_UNVERIFIED") throw new AchievementError("COMMIT_UNVERIFIED", 409);
    if (slot.liveError) {
      await tx.achievementSyncState.update({ where: { id: 1 }, data: { liveError: null, liveFailures: 0, retryAt: null } });
    }
  });
  wakeAchievements();
  return { queued: true };
}

async function discover(tx: Prisma.TransactionClient, job: AchievementJob) {
  const users = await tx.userProfile.findMany({ where: {
    id: { gt: job.userCursor, lte: job.userWatermark, ...(job.userId ? { equals: job.userId } : {}) },
    createdAt: { lte: job.createdAt },
  }, orderBy: { id: "asc" }, take: 10, select: { id: true } });
  if (!users.length) {
    await tx.achievementJob.update({ where: { id: job.id }, data: { phase: "PREVIEW" } });
    return;
  }
  await tx.achievementJobItem.createMany({ data: users.map(user => ({ jobId: job.id, userId: user.id })) });
  await tx.achievementJob.update({ where: { id: job.id }, data: { userCursor: users.at(-1)!.id, users: { increment: users.length } } });
}

async function updateItem(tx: Prisma.TransactionClient, item: AchievementJobItem, data: Prisma.AchievementJobItemUpdateInput) {
  await tx.achievementJobItem.update({ where: { jobId_userId: { jobId: item.jobId, userId: item.userId } }, data });
}

async function stageLegacy(tx: Prisma.TransactionClient, item: AchievementJobItem, metrics: MetricKey[], streak: boolean, batchSize: number) {
  const selected = metrics.filter(metric => isStreak(metric) === streak);
  const facts = selected.length ? await legacyEvidence(tx, { userId: item.userId, id: item.factCursor, streak, limit: streak ? Math.min(4, batchSize) : batchSize }) : [];
  if (!facts.length) {
    await updateItem(tx, item, { phase: streak ? "LIVE" : "EXITS", factCursor: "" });
    return;
  }
  const rows: Evidence[] = [];
  for (const fact of facts) {
    if (selected.includes("foundation")) await verifyFoundation(tx, fact);
    rows.push({ fact, seq: 0, mask: streak ? await historicalExit(tx, fact) : null, historical: true });
  }
  for (const metric of selected) await applyEvidence(tx, item.userId, metric, item.jobId, rows);
  await updateItem(tx, item, { factCursor: facts.at(-1)!.id });
}

async function stageLive(tx: Prisma.TransactionClient, item: AchievementJobItem, metrics: MetricKey[], ceiling: number, batchSize: number) {
  const rows = await tx.achievementFact.findMany({
    where: { userId: item.userId, seq: { gt: item.liveCursor, lte: ceiling } },
    orderBy: { seq: "asc" }, take: batchSize,
  });
  if (!rows.length) return false;
  const evidence = await indexedEvidence(tx, rows);
  const batch = metrics.some(isStreak) ? await recheckIndexedExits(tx, evidence) : evidence;
  for (const metric of metrics) await applyEvidence(tx, item.userId, metric, item.jobId, batch);
  await updateItem(tx, item, { liveCursor: batch.at(-1)!.seq });
  return true;
}

async function estimate(tx: Prisma.TransactionClient, job: AchievementJob, item: AchievementJobItem, metrics: MetricKey[]) {
  const known = await tx.userAchievement.findMany({ where: { userId: item.userId }, select: { achievementKey: true, tierKey: true } });
  const unlocked = new Set(known.map(row => row.achievementKey + "/" + row.tierKey));
  let expectedAwards = 0, coverageGaps = 0;
  for (const metric of metrics) {
    const summary = await metricSummary(tx, item.userId, metric, item.jobId);
    coverageGaps += summary.coverageGaps;
    expectedAwards += qualifyingAwards(item.userId, metric, summary).filter(row => !unlocked.has(row.achievementKey + "/" + row.tierKey)).length;
  }
  await updateItem(tx, item, { status: "PREVIEWED", phase: "CATCH_UP" });
  await tx.achievementJob.update({ where: { id: job.id }, data: {
    processed: { increment: 1 }, expectedAwards: { increment: expectedAwards }, coverageGaps: { increment: coverageGaps },
  } });
}

async function publish(tx: Prisma.TransactionClient, job: AchievementJob, item: AchievementJobItem, metrics: MetricKey[]) {
  const retired: Record<string, string> = {};
  const awards: ReturnType<typeof qualifyingAwards> = [];
  for (const metric of metrics) {
    const key = metricIdentity(item.userId, metric);
    const state = await tx.userAchievementState.findUnique({ where: { userId_metricKey: key } });
    if (state) retired[metric] = state.generation;
    const summary = await metricSummary(tx, item.userId, metric, job.id);
    awards.push(...qualifyingAwards(item.userId, metric, summary, true));
    const data = { generation: job.id, fingerprint: metricFingerprints[metric], lastAppliedSeq: item.liveCursor, historyChecked: true };
    if (state) {
      const swapped = await tx.userAchievementState.updateMany({ where: { ...key, generation: state.generation, lastAppliedSeq: state.lastAppliedSeq, fingerprint: state.fingerprint }, data });
      if (swapped.count !== 1) throw new Error("ACHIEVEMENT_GENERATION_CHANGED");
    } else {
      await tx.userAchievementState.create({ data: { ...key, ...data } });
    }
  }
  const published = await publishAwards(tx, awards, true);
  await updateItem(tx, item, { phase: "RETIRE", retired: JSON.stringify(retired) });
  await tx.achievementJob.update({ where: { id: job.id }, data: { published: { increment: published } } });
}

async function retire(tx: Prisma.TransactionClient, item: AchievementJobItem) {
  const generations = retiredSchema.parse(JSON.parse(item.retired));
  const [metric, generation] = Object.entries(generations)[0] ?? [];
  if (!metric) {
    await updateItem(tx, item, { phase: "DONE", status: "SUCCEEDED" });
    return;
  }
  const scope = { userId: item.userId, metricKey: metric, generation };
  const rows = await tx.userAchievementProgress.findMany({ where: scope, select: { scopeKey: true }, take: 100 });
  if (rows.length) {
    await tx.userAchievementProgress.deleteMany({ where: { ...scope, scopeKey: { in: rows.map(row => row.scopeKey) } } });
  } else {
    delete generations[metric];
    await updateItem(tx, item, { retired: JSON.stringify(generations) });
  }
}

async function discardBatch(tx: Prisma.TransactionClient, job: AchievementJob) {
  const item = await tx.achievementJobItem.findFirst({
    where: { jobId: job.id, userId: { gt: job.userCursor } },
    orderBy: { userId: "asc" }, select: { userId: true },
  });
  if (!item) {
    await tx.achievementJob.update({ where: { id: job.id }, data: { status: "DISCARDED", phase: "DONE" } });
    return;
  }
  // An expired job may have published some profiles. Keep their active cells.
  const active = await tx.userAchievementState.findMany({
    where: { userId: item.userId, generation: job.id }, select: { metricKey: true },
  });
  const scope = { userId: item.userId, generation: job.id };
  const metrics = z.array(z.string()).parse(JSON.parse(job.metrics));
  const rows = await tx.userAchievementProgress.findMany({
    where: { ...scope, metricKey: { in: metrics.filter(metric => !active.some(state => state.metricKey === metric)) } },
    select: { metricKey: true, scopeKey: true }, take: 100,
  });
  if (rows.length) {
    await tx.userAchievementProgress.deleteMany({ where: { ...scope, OR: rows } });
  } else {
    await tx.achievementJob.update({ where: { id: job.id }, data: { userCursor: item.userId } });
  }
}

export async function processJobBatch(tx: Prisma.TransactionClient, job: AchievementJob, batchSize: number) {
  if (job.status === "DISCARDING") return discardBatch(tx, job);
  const metrics = jobMetrics(job);
  if (job.phase === "DISCOVER") return discover(tx, job);
  const preview = job.status === "PREVIEW";
  const item = await tx.achievementJobItem.findFirst({ where: { jobId: job.id, status: preview ? "QUEUED" : "PREVIEWED" }, orderBy: { userId: "asc" } });
  if (!item) {
    await tx.achievementJob.update({ where: { id: job.id }, data: { status: preview ? "READY" : "SUCCEEDED", phase: preview ? "READY" : "DONE" } });
    return;
  }
  if (preview) {
    if (item.phase === "TOTALS" || item.phase === "EXITS") return stageLegacy(tx, item, metrics, item.phase === "EXITS", batchSize);
    if (await stageLive(tx, item, metrics, job.liveWatermark, batchSize)) return;
    return estimate(tx, job, item, metrics);
  }
  if (job.status === "QUEUED") await tx.achievementJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
  if (item.phase === "RETIRE") return retire(tx, item);
  const last = await tx.achievementFact.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
  if (await stageLive(tx, item, metrics, last?.seq ?? 0, batchSize)) return;
  // The global write slot fences new evidence between the empty catch-up read and
  // publishing this user's pointers, milestones and job item.
  return publish(tx, job, item, metrics);
}
