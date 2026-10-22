import { randomUUID } from "node:crypto";
import type { MarketAggregationGeneration, MarketAggregationJob, MarketDataset, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { activeAggregationJob, aggregationOwner, assertDatasetIdle, LEASE_MS, reclaimAggregationJobs, releaseDatasetLease } from "@/lib/market-sync/lease";
import { backgroundWritePolicy, isSqliteBusy, retrySqliteWrite, sqlitePause, sqliteWriteTransaction, SqliteCommitUncertainError, SqliteWriteBusyError } from "@/lib/sqlite-write";
import { createAggregationGeneration, generationMatches, writeAggregationChunk } from "./aggregation-storage";
import { AGGREGATION_RULE_VERSION, aggregationFingerprint } from "./time-aggregation";

export const AGGREGATION_BATCH_SIZE = process.env.SQLITE_DRIVER === "better-sqlite3" ? 1024 : 4096;
const LEASE_MARGIN_MS = 1000;
type BuildJob = MarketAggregationJob & { generation: MarketAggregationGeneration | null };
export type AggregationResult = { status: "DEFERRED" | "COMPLETED" | "CANCELLED" | "FAILED" | "INTERRUPTED" };
class OwnershipLost extends Error { constructor() { super(copy.marketSync.busy); } }
const write = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => sqliteWriteTransaction(prisma, work, undefined, backgroundWritePolicy);
const report = (stage: string, jobId: string, error: unknown) => console.warn(JSON.stringify({ event: "aggregation-worker", stage, jobId, code: error instanceof Error ? error.name : "UNKNOWN" }));

function sourceMatches(job: BuildJob, dataset: MarketDataset) {
  return dataset.status === "READY" && !!dataset.sourceIntervalSeconds && !!job.generation
    && job.generation.status === "BUILDING" && job.generation.ruleVersion === AGGREGATION_RULE_VERSION
    && job.generation.historyVersion === dataset.historyVersion && job.generation.fingerprint === aggregationFingerprint(dataset)
    && job.targetSequence === dataset.barCount - 1 && job.generation.cursor === job.cursor;
}

/** The first statement acquires the write slot without extending an expired lease. */
async function owned(tx: Prisma.TransactionClient, jobId: string, token: string) {
  const owner = aggregationOwner(jobId, token);
  await tx.$executeRaw`UPDATE "MarketDatasetUpdateLease" SET "owner" = "owner" WHERE "owner" = ${owner}`;
  const job = await tx.marketAggregationJob.findUniqueOrThrow({ where: { id: jobId }, include: { generation: true } });
  const lease = await tx.marketDatasetUpdateLease.findUnique({ where: { datasetId: job.datasetId } });
  const now = Date.now();
  if (job.status !== "RUNNING" || job.workerToken !== token || !job.leaseUntil || job.leaseUntil.getTime() <= now + LEASE_MARGIN_MS
    || lease?.owner !== owner || lease.expiresAt.getTime() <= now + LEASE_MARGIN_MS) throw new OwnershipLost();
  return { job, owner };
}
async function renew(tx: Prisma.TransactionClient, job: MarketAggregationJob, owner: string) {
  const now = Date.now();
  // The original execution must remain valid through the complete atomic batch.
  const lease = await tx.marketDatasetUpdateLease.findUnique({ where: { datasetId: job.datasetId } });
  if (!job.leaseUntil || job.leaseUntil.getTime() <= now + LEASE_MARGIN_MS
    || lease?.owner !== owner || lease.expiresAt.getTime() <= now + LEASE_MARGIN_MS) throw new OwnershipLost();
  const until = new Date(now + LEASE_MS);
  await tx.marketAggregationJob.update({ where: { id: job.id }, data: { leaseUntil: until } });
  await tx.marketDatasetUpdateLease.update({ where: { datasetId: job.datasetId }, data: { expiresAt: until } });
}

/** Cleanup is bounded and has the same contention policy as construction. */
async function cleanRetiredGenerations(datasetId: string) {
  const retired = await prisma.marketAggregationGeneration.findMany({ where: { datasetId, status: "RETIRED", updatedAt: { lt: new Date(Date.now() - 86400000) } }, select: { id: true } });
  for (const generation of retired) {
    for (;;) {
      const count = await retrySqliteWrite(() => prisma.$executeRaw`DELETE FROM "MarketAggregatedBar" WHERE rowid IN (SELECT rowid FROM "MarketAggregatedBar" WHERE "generationId" = ${generation.id} LIMIT 1000)`, backgroundWritePolicy);
      if (!count) break;
      await sqlitePause(20);
    }
    await retrySqliteWrite(() => prisma.marketAggregationGeneration.deleteMany({ where: { id: generation.id, status: "RETIRED" } }), backgroundWritePolicy);
  }
}
export async function aggregationStatus(datasetId: string) {
  const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: datasetId } });
  const job = await activeAggregationJob(prisma, datasetId)
    ?? await prisma.marketAggregationJob.findFirst({ where: { datasetId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const generation = dataset.activeAggregationId ? await prisma.marketAggregationGeneration.findUnique({ where: { id: dataset.activeAggregationId } }) : null;
  const lastGeneration = generation ?? await prisma.marketAggregationGeneration.findFirst({ where: { datasetId }, orderBy: { createdAt: "desc" } });
  return {
    ready: !!generation && generationMatches(dataset, generation), generationId: generation?.id ?? null, ruleVersion: AGGREGATION_RULE_VERSION,
    buildFailed: lastGeneration?.status === "FAILED",
    job: job ? { id: job.id, status: job.status, processed: job.cursor + 1, total: job.targetSequence + 1,
      error: job.error, updatedAt: job.updatedAt.toISOString() } : null,
  };
}

export async function queueAggregation(datasetId: string, resumeJobId?: string) {
  const queueToken = randomUUID(), jobId = randomUUID(), generationId = randomUUID();
  return write(async (tx) => {
    await tx.$executeRaw`UPDATE "MarketDataset" SET "id" = "id" WHERE "id" = ${datasetId}`;
    await reclaimAggregationJobs(tx);
    const running = await activeAggregationJob(tx, datasetId);
    if (running) return running;
    await assertDatasetIdle(datasetId, tx);
    const dataset = await tx.marketDataset.findUniqueOrThrow({ where: { id: datasetId } });
    if (dataset.status !== "READY" || !dataset.sourceIntervalSeconds) throw new Error(copy.marketReplay.aggregation.unavailable);
    if (resumeJobId) {
      const job = await tx.marketAggregationJob.findFirstOrThrow({ where: { id: resumeJobId, datasetId }, include: { generation: true } });
      if (!["FAILED", "CANCELLED", "INTERRUPTED"].includes(job.status) || !sourceMatches(job, dataset)) throw new Error(copy.marketReplay.aggregation.sourceChanged);
      return tx.marketAggregationJob.update({ where: { id: job.id }, data: { activeDatasetId: datasetId, status: "QUEUED", cancelRequested: false, error: null, workerToken: queueToken, leaseUntil: null } });
    }
    const generation = await createAggregationGeneration(tx, dataset, generationId);
    return tx.marketAggregationJob.create({ data: { id: jobId, datasetId, activeDatasetId: datasetId, generationId: generation.id, targetSequence: dataset.barCount - 1, workerToken: queueToken } });
  });
}

export async function cancelAggregation(datasetId: string, identity?: Pick<MarketAggregationJob, "id" | "status" | "workerToken" | "updatedAt">) {
  const selected = identity ?? await activeAggregationJob(prisma, datasetId);
  if (!selected) return;
  return write(async (tx) => {
    const result = await tx.marketAggregationJob.updateMany({
      where: { id: selected.id, activeDatasetId: datasetId, status: selected.status, workerToken: selected.workerToken, ...(selected.status === "QUEUED" ? { updatedAt: selected.updatedAt } : {}) },
      data: selected.status === "QUEUED"
        ? { status: "CANCELLED", activeDatasetId: null, workerToken: null, leaseUntil: null, cancelRequested: true }
        : { cancelRequested: true },
    });
    if (!result.count) throw new Error(copy.marketSync.busy);
  });
}

/** All callers, including CLI workers, participate in the same cross-process queue. */
async function claimAggregation(jobId: string, queueToken: string | null, token: string) {
  return write(async (tx) => {
    await tx.$executeRaw`UPDATE "MarketAggregationJob" SET "status" = "status" WHERE "id" = ${jobId} AND "status" = 'QUEUED'`;
    if (await reclaimAggregationJobs(tx)) return false;
    const queued = await tx.marketAggregationJob.findMany({ where: { status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { dataset: true, generation: true } });
    for (const candidate of queued) {
      if (!sourceMatches(candidate, candidate.dataset)) {
        await tx.marketAggregationJob.update({ where: { id: candidate.id }, data: { status: "FAILED", activeDatasetId: null, workerToken: null, leaseUntil: null, error: copy.marketReplay.aggregation.sourceChanged } });
        continue;
      }
      const lease = await tx.marketDatasetUpdateLease.findUnique({ where: { datasetId: candidate.datasetId } });
      const now = new Date();
      if (lease && lease.expiresAt > now) continue;
      if (candidate.id !== jobId || candidate.workerToken !== queueToken) return false;
      const owner = aggregationOwner(jobId, token), until = new Date(now.getTime() + LEASE_MS);
      await tx.marketDatasetUpdateLease.upsert({ where: { datasetId: candidate.datasetId }, create: { datasetId: candidate.datasetId, owner, expiresAt: until }, update: { owner, expiresAt: until } });
      const result = await tx.marketAggregationJob.updateMany({ where: { id: jobId, status: "QUEUED", workerToken: queueToken }, data: { status: "RUNNING", workerToken: token, leaseUntil: until } });
      if (!result.count) throw new OwnershipLost();
      return true;
    }
    return false;
  });
}

export async function processAggregationJob(jobId: string, hooks?: { afterBatch?: () => Promise<void> }, expectedQueueToken?: string | null): Promise<AggregationResult> {
  const token = randomUUID();
  const initial = await prisma.marketAggregationJob.findUniqueOrThrow({ where: { id: jobId } });
  if (initial.status !== "QUEUED") return { status: ["COMPLETED", "CANCELLED", "FAILED", "INTERRUPTED"].includes(initial.status) ? initial.status as AggregationResult["status"] : "DEFERRED" };
  const owner = aggregationOwner(jobId, token);
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: Promise<void> | undefined, heartbeatError: unknown;
  let claimed = false, uncertain = false;
  async function stopHeartbeat() { clearInterval(timer); await heartbeat; }
  try {
    if (!await claimAggregation(jobId, expectedQueueToken === undefined ? initial.workerToken : expectedQueueToken, token)) return { status: "DEFERRED" };
    claimed = true;
    timer = setInterval(() => {
      if (heartbeat || heartbeatError) return;
      heartbeat = write(async (tx) => { const current = await owned(tx, jobId, token); await renew(tx, current.job, owner); })
        .catch((error: unknown) => { heartbeatError = error; }).finally(() => { heartbeat = undefined; });
    }, 20000);
    for (;;) {
      if (heartbeatError) throw heartbeatError;
      const terminal = await write(async (tx) => {
        const { job } = await owned(tx, jobId, token);
        if (job.cancelRequested) {
          await tx.marketAggregationJob.update({ where: { id: jobId }, data: { status: "CANCELLED", activeDatasetId: null, workerToken: null, leaseUntil: null } });
          return "CANCELLED" as const;
        }
        const dataset = await tx.marketDataset.findUniqueOrThrow({ where: { id: job.datasetId } });
        if (!sourceMatches(job, dataset)) throw new Error(copy.marketReplay.aggregation.sourceChanged);
        const bars = await tx.marketBar.findMany({ where: { datasetId: dataset.id, sequence: { gt: job.cursor, lte: job.targetSequence } }, orderBy: { sequence: "asc" }, take: AGGREGATION_BATCH_SIZE });
        if (bars.length) {
          await writeAggregationChunk(tx, job.generation!.id, dataset, bars);
          await renew(tx, job, owner);
          await tx.marketAggregationJob.update({ where: { id: jobId }, data: { cursor: bars.at(-1)!.sequence } });
          return null;
        }
        if (job.cursor !== job.targetSequence) throw new Error("AGGREGATION_SEQUENCE_GAP");
        await renew(tx, job, owner);
        await tx.marketAggregationGeneration.updateMany({ where: { datasetId: dataset.id, status: "READY", id: { not: job.generation!.id } }, data: { status: "RETIRED" } });
        await tx.marketAggregationGeneration.update({ where: { id: job.generation!.id }, data: { status: "READY" } });
        await tx.marketDataset.update({ where: { id: dataset.id }, data: { activeAggregationId: job.generation!.id } });
        await tx.marketAggregationJob.update({ where: { id: jobId }, data: { status: "COMPLETED", activeDatasetId: null, workerToken: null, leaseUntil: null } });
        return "COMPLETED" as const;
      });
      if (terminal) {
        await stopHeartbeat();
        await releaseDatasetLease(initial.datasetId, owner);
        if (terminal === "COMPLETED") await cleanRetiredGenerations(initial.datasetId).catch((error) => report("cleanup", jobId, error));
        return { status: terminal };
      }
      await hooks?.afterBatch?.();
      await sqlitePause(10 + Math.random() * 20);
    }
  } catch (error) {
    await stopHeartbeat();
    uncertain = error instanceof SqliteCommitUncertainError || heartbeatError instanceof SqliteCommitUncertainError;
    if (uncertain) {
      // Read-only reconciliation can confirm a successful final publish. Otherwise retain the lease for recovery.
      const saved = await prisma.marketAggregationJob.findUnique({ where: { id: jobId } }).catch(() => null);
      if (saved?.status === "COMPLETED" && saved.generationId === initial.generationId) return { status: "COMPLETED" };
      report("commit-uncertain", jobId, error);
    } else if (claimed && !(error instanceof OwnershipLost)) {
      try {
        await write(async (tx) => {
          await owned(tx, jobId, token);
          await tx.marketAggregationJob.update({ where: { id: jobId }, data: {
            status: error instanceof SqliteWriteBusyError || isSqliteBusy(error) ? "INTERRUPTED" : "FAILED",
            activeDatasetId: null, workerToken: null, leaseUntil: null,
            error: error instanceof Error ? error.message : copy.marketReplay.aggregation.failed,
          } });
        });
      } catch (failure) { if (failure instanceof SqliteCommitUncertainError) uncertain = true; report("terminal", jobId, failure); }
    }
    throw error;
  } finally {
    await stopHeartbeat();
    if (claimed && !uncertain) await releaseDatasetLease(initial.datasetId, owner).catch((error) => report("release", jobId, error));
  }
}
