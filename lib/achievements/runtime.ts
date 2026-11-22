import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { freemem } from "node:os";
import type { AchievementJob, AchievementSyncState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SqliteCommitUncertainError, SqliteWriteBusyError, sqliteWriteTransaction } from "@/lib/sqlite-write";
import { metricFingerprints, metricKeys } from "./catalog";
import { indexedEvidence, verifyFoundation, type Evidence } from "./evidence";
import { AchievementError, processJobBatch, runnableJobs } from "./jobs";
import { applyEvidence, metricEvidence, metricIdentity, publishAwards, qualifyingAwards } from "./projection";
import { registerAchievementWake } from "./wake";

const retryDelays = [5_000, 15_000, 30_000];
const shortOptions = { maxWait: 100, timeout: 1_000, writeFence: false };
const shortPolicy = { attempts: 1, budgetMs: 1_500, delayMs: 0, maxDelayMs: 0 };
const syncKey = { id: 1 };
const idle = 30_000;
const pause = 250;
type Work = { kind: "live" } | { kind: "history"; job: AchievementJob };

async function processLive(tx: Prisma.TransactionClient, slot: AchievementSyncState, size: number) {
  const indexes = await tx.achievementFact.findMany({ where: { seq: { gt: slot.lastAppliedSeq } }, orderBy: { seq: "asc" }, take: size });
  if (!indexes.length) return {};
  const rows = await indexedEvidence(tx, indexes);
  const grouped = new Map<string, Evidence[]>();
  for (const row of rows) {
    await verifyFoundation(tx, row.fact);
    const items = grouped.get(row.fact.userId) ?? [];
    items.push(row);
    grouped.set(row.fact.userId, items);
  }
  for (const [userId, events] of grouped) {
    const awards: ReturnType<typeof qualifyingAwards> = [];
    for (const metric of metricKeys) {
      const relevant = events.filter(row => !!metricEvidence(metric, row));
      if (!relevant.length) continue;
      const key = metricIdentity(userId, metric);
      const state = await tx.userAchievementState.findUnique({ where: { userId_metricKey: key } });
      // A changed evaluator must be rebuilt; its evidence stays in the durable index.
      if (state && state.fingerprint !== metricFingerprints[metric]) continue;
      const pending = relevant.filter(row => row.seq > (state?.lastAppliedSeq ?? 0));
      if (!pending.length) continue;
      const summary = await applyEvidence(tx, userId, metric, state?.generation ?? "live", pending);
      const lastAppliedSeq = pending.at(-1)!.seq;
      if (state) {
        const result = await tx.userAchievementState.updateMany({ where: { ...key, generation: state.generation, fingerprint: state.fingerprint, lastAppliedSeq: state.lastAppliedSeq }, data: { lastAppliedSeq } });
        if (result.count !== 1) throw new Error("ACHIEVEMENT_GENERATION_CHANGED");
      } else {
        await tx.userAchievementState.create({ data: { ...key, fingerprint: metricFingerprints[metric], lastAppliedSeq } });
      }
      if (summary) awards.push(...qualifyingAwards(userId, metric, summary));
    }
    await publishAwards(tx, awards);
  }
  return { lastAppliedSeq: indexes.at(-1)!.seq, lastSyncedAt: new Date(), liveFailures: 0, liveError: null, retryAt: null };
}

async function recordFailure(work: Work, slot: AchievementSyncState, error: unknown, uncertain: boolean) {
  const attempt = (work.kind === "live" ? slot.liveFailures : work.job.attempts) + 1;
  const delay = error instanceof SqliteWriteBusyError ? retryDelays[attempt - 1] : undefined;
  const code = uncertain ? "COMMIT_UNVERIFIED"
    : error instanceof AchievementError ? error.code
    : error instanceof SqliteWriteBusyError ? "DATABASE_BUSY" : "BATCH_FAILED";
  const retryAt = delay ? new Date(Date.now() + delay) : null;
  await sqliteWriteTransaction(prisma, async tx => {
    const current = await tx.achievementSyncState.findUniqueOrThrow({ where: syncKey });
    if (!uncertain && current.batchToken !== slot.batchToken) return;
    if (work.kind === "live") {
      await tx.achievementSyncState.update({ where: syncKey, data: { liveFailures: attempt, liveError: code, retryAt } });
    } else {
      await tx.achievementJob.updateMany({
        where: { id: work.job.id, status: work.job.status, phase: work.job.phase },
        data: { attempts: attempt, error: code, retryAt, ...(!delay && { status: "FAILED" }) },
      });
    }
  }, { ...shortOptions, writeFence: true }, shortPolicy);
}

/** A short transaction is also the lease period. The fenced first write
 * serializes SQLite workers, and the receipt commits with every cursor. */
async function runBatch(work: Work, slot: AchievementSyncState, size: number) {
  const owner = randomUUID();
  try {
    return await sqliteWriteTransaction(prisma, async tx => {
      const now = new Date();
      const acquired = await tx.achievementSyncState.updateMany({
        where: { ...syncKey, batchToken: slot.batchToken, OR: [{ ownerToken: null }, { leaseUntil: { lt: now } }] },
        data: { ownerToken: owner, leaseUntil: new Date(now.getTime() + 60_000) },
      });
      if (!acquired.count) return false;
      let progress: Prisma.AchievementSyncStateUpdateManyMutationInput = {};
      if (work.kind === "live") progress = await processLive(tx, slot, size);
      else {
        const job = await tx.achievementJob.findUnique({ where: { id: work.job.id } });
        if (job && runnableJobs.includes(job.status) && (!job.retryAt || job.retryAt <= now)) {
          await processJobBatch(tx, job, size);
          if (job.attempts || job.error) await tx.achievementJob.update({ where: { id: job.id }, data: { attempts: 0, error: null, retryAt: null } });
          progress = { lastSyncedAt: new Date() };
        }
      }
      const released = await tx.achievementSyncState.updateMany({
        where: { ...syncKey, ownerToken: owner, leaseUntil: { gt: new Date() } },
        data: { ...progress, ownerToken: null, leaseUntil: null, batchToken: owner },
      });
      if (released.count !== 1) throw new Error("ACHIEVEMENT_LEASE_LOST");
      return true;
    }, shortOptions, shortPolicy);
  } catch (error) {
    if (error instanceof SqliteCommitUncertainError) {
      const actual = await prisma.achievementSyncState.findUniqueOrThrow({ where: syncKey });
      if (actual.batchToken === owner) return true;
      await recordFailure(work, slot, error, actual.batchToken !== slot.batchToken);
    } else {
      await recordFailure(work, slot, error, false);
    }
    console.warn(JSON.stringify({ event: "achievement-batch", kind: work.kind, jobId: work.kind === "history" ? work.job.id : undefined, error: error instanceof Error ? error.name : "unknown" }));
    return false;
  }
}

async function heavyWorkActive() {
  const available = process.availableMemory?.() ?? freemem();
  if (available < 384 * 1024 * 1024) return true;
  const [importing, aggregating, correcting, ai] = await Promise.all([
    prisma.marketDatasetImport.findFirst({ where: { status: "PROCESSING" }, select: { id: true } }),
    prisma.marketAggregationJob.findFirst({ where: { status: "RUNNING" }, select: { id: true } }),
    prisma.replayCorrectionJob.findFirst({ where: { status: "RUNNING" }, select: { id: true } }),
    prisma.aiRun.findFirst({ where: { status: "RUNNING" }, select: { id: true } }),
  ]);
  return !!(importing || aggregating || correcting || ai);
}

/** Exported for isolated, deterministic integration verification. */
export async function achievementTick({ allowHistory = true, liveSize = 25, historySize = 24, now = new Date() } = {}) {
  let slot = await prisma.achievementSyncState.findUnique({ where: syncKey });
  if (!slot) throw new Error("ACHIEVEMENT_SCHEMA_NOT_READY");
  if (!slot.enabledAt) {
    await prisma.achievementSyncState.updateMany({ where: { ...syncKey, enabledAt: null }, data: { enabledAt: now } });
  }
  const live = (!slot.liveError || (slot.retryAt && slot.retryAt <= now))
    && await prisma.achievementFact.findFirst({ where: { seq: { gt: slot.lastAppliedSeq } }, select: { seq: true } });
  let worked = false;
  if (live) {
    worked = await runBatch({ kind: "live" }, slot, liveSize);
    slot = await prisma.achievementSyncState.findUniqueOrThrow({ where: syncKey });
  }
  const eligible = { OR: [{ retryAt: null }, { retryAt: { lte: now } }] };
  const job = await prisma.achievementJob.findFirst({
    where: { ...eligible, status: { in: runnableJobs.filter(status => status !== "DISCARDING") } },
    orderBy: { createdAt: "asc" },
  }) ?? await prisma.achievementJob.findFirst({
    where: { ...eligible, status: "DISCARDING" },
    orderBy: { createdAt: "asc" },
  });
  const blocked = job && (!allowHistory || await heavyWorkActive());
  if (job && !blocked) worked = await runBatch({ kind: "history", job }, slot, historySize) || worked;
  return worked ? pause : blocked ? 5_000 : idle;
}

const globals = globalThis as typeof globalThis & { achievementRuntime?: boolean };
export function startAchievementRuntime() {
  if (globals.achievementRuntime || process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build") return;
  globals.achievementRuntime = true;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let timer: NodeJS.Timeout | undefined;
  let running = false, requested = false, stopped = false;
  let historySize = 24, liveSize = 25, quiet = false;
  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
    timer.unref();
  };
  async function tick() {
    timer = undefined;
    if (running || stopped) return;
    running = true;
    requested = false;
    let next = idle;
    const started = performance.now();
    try {
      next = await achievementTick({ allowHistory: delay.percentile(95) < 50_000_000, liveSize, historySize });
      if (next === pause && performance.now() - started > 100) {
        historySize = Math.max(4, Math.floor(historySize / 2));
        liveSize = Math.max(4, Math.floor(liveSize / 2));
      }
    } catch (error) {
      if (!quiet) console.warn(JSON.stringify({ event: "achievement-runtime", error: error instanceof Error ? error.name : "unknown" }));
      next = idle;
    } finally {
      running = false;
      delay.reset();
      const wait = next === idle && quiet ? 60_000 : next;
      quiet = next === idle;
      schedule(requested ? pause : wait);
    }
  }
  registerAchievementWake(() => {
    if (requested) return;
    requested = true;
    if (!running) schedule(pause);
  });
  const stop = () => { stopped = true; clearTimeout(timer); delay.disable(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  schedule(1_000);
}
