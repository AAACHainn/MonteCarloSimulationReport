import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { acquireDatasetLease, activeAggregationJob, assertDatasetIdle, LEASE_MS, releaseDatasetLease } from "@/lib/market-sync/lease";
import { createAggregationGeneration, generationMatches, writeAggregationChunk } from "./aggregation-storage";
import { AGGREGATION_RULE_VERSION, aggregationFingerprint } from "./time-aggregation";

const BATCH_SIZE = 4096;
/** Keep retired snapshots for in-flight readers, then reclaim them in short transactions. */
async function cleanRetiredGenerations(datasetId: string) {
  const retired = await prisma.marketAggregationGeneration.findMany({ where: { datasetId, status: "RETIRED", updatedAt: { lt: new Date(Date.now() - 86400000) } }, select: { id: true } });
  for (const generation of retired) {
    for (;;) {
      const count = await prisma.$executeRaw`DELETE FROM "MarketAggregatedBar" WHERE rowid IN (SELECT rowid FROM "MarketAggregatedBar" WHERE "generationId" = ${generation.id} LIMIT 1000)`;
      if (!count) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await prisma.marketAggregationGeneration.deleteMany({ where: { id: generation.id, status: "RETIRED" } });
  }
}
export async function aggregationStatus(datasetId: string) {
  const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: datasetId } });
  const job = await activeAggregationJob(prisma, datasetId)
    ?? await prisma.marketAggregationJob.findFirst({ where: { datasetId }, orderBy: { createdAt: "desc" } });
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
  await aggregationStatus(datasetId);
  const owner = `aggregation_queue_${randomUUID()}`;
  return prisma.$transaction(async (tx) => {
    const running = await activeAggregationJob(tx, datasetId);
    if (running) return running;
    await assertDatasetIdle(datasetId, tx);
    await acquireDatasetLease(tx, datasetId, owner);
    try {
      const dataset = await tx.marketDataset.findUniqueOrThrow({ where: { id: datasetId } });
      if (dataset.status !== "READY" || !dataset.sourceIntervalSeconds) throw new Error(copy.marketReplay.aggregation.unavailable);
      if (resumeJobId) {
        const job = await tx.marketAggregationJob.findFirstOrThrow({ where: { id: resumeJobId, datasetId }, include: { generation: true } });
        if (!["FAILED", "CANCELLED", "INTERRUPTED"].includes(job.status) || !job.generation
          || job.generation.ruleVersion !== AGGREGATION_RULE_VERSION || job.generation.historyVersion !== dataset.historyVersion || job.generation.fingerprint !== aggregationFingerprint(dataset)
          || job.targetSequence !== dataset.barCount - 1) throw new Error(copy.marketReplay.aggregation.sourceChanged);
        return tx.marketAggregationJob.update({ where: { id: job.id }, data: { activeDatasetId: datasetId, status: "QUEUED", cancelRequested: false, error: null, workerToken: null } });
      }
      const generation = await createAggregationGeneration(tx, dataset);
      return tx.marketAggregationJob.create({ data: { datasetId, activeDatasetId: datasetId, generationId: generation.id, targetSequence: dataset.barCount - 1 } });
    } finally { await tx.marketDatasetUpdateLease.deleteMany({ where: { datasetId, owner } }); }
  }, { maxWait: 30000, timeout: 30000 });
}

export async function cancelAggregation(datasetId: string) {
  await prisma.marketAggregationJob.updateMany({ where: { datasetId, activeDatasetId: datasetId }, data: { cancelRequested: true } });
}

/** Persisted worker, bounded transactions, one generation becomes visible only after success. */
export async function processAggregationJob(jobId: string, hooks?: { afterBatch?: () => Promise<void> }) {
  const token = randomUUID();
  const initial = await prisma.marketAggregationJob.findUniqueOrThrow({ where: { id: jobId } });
  const owner = `aggregation_${jobId}_${token}`;
  let timer: ReturnType<typeof setInterval> | undefined;
  let claimed = false;
  let leaseAcquired = false;
  try {
    await acquireDatasetLease(prisma, initial.datasetId, owner);
    leaseAcquired = true;
    const claim = await prisma.marketAggregationJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "RUNNING", workerToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) } });
    if (!claim.count) return;
    claimed = true;
    timer = setInterval(() => { void prisma.$transaction(async (tx) => {
      await tx.marketAggregationJob.updateMany({ where: { id: jobId, workerToken: token }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
      await tx.marketDatasetUpdateLease.updateMany({ where: { datasetId: initial.datasetId, owner }, data: { expiresAt: new Date(Date.now() + LEASE_MS) } });
    }).catch(() => undefined); }, 20000);
    for (;;) {
      const finished = await prisma.$transaction(async (tx) => {
        const job = await tx.marketAggregationJob.findUniqueOrThrow({ where: { id: jobId }, include: { generation: true } });
        const dataset = await tx.marketDataset.findUniqueOrThrow({ where: { id: job.datasetId } });
        const lease = await tx.marketDatasetUpdateLease.findUnique({ where: { datasetId: dataset.id } });
        if (job.workerToken !== token || job.status !== "RUNNING" || !lease || lease.owner !== owner || lease.expiresAt <= new Date()) throw new Error(copy.marketSync.busy);
        if (job.cancelRequested) {
          await tx.marketAggregationJob.update({ where: { id: jobId }, data: { status: "CANCELLED", activeDatasetId: null, workerToken: null, leaseUntil: null } });
          return true;
        }
        if (!job.generation || job.generation.ruleVersion !== AGGREGATION_RULE_VERSION || job.generation.historyVersion !== dataset.historyVersion
          || job.generation.fingerprint !== aggregationFingerprint(dataset) || dataset.barCount - 1 !== job.targetSequence) throw new Error(copy.marketReplay.aggregation.sourceChanged);
        const bars = await tx.marketBar.findMany({ where: { datasetId: dataset.id, sequence: { gt: job.cursor, lte: job.targetSequence } }, orderBy: { sequence: "asc" }, take: BATCH_SIZE });
        if (bars.length) {
          await writeAggregationChunk(tx, job.generation.id, dataset, bars);
          await tx.marketAggregationJob.update({ where: { id: jobId }, data: { cursor: bars.at(-1)!.sequence, leaseUntil: new Date(Date.now() + LEASE_MS) } });
          await tx.marketDatasetUpdateLease.update({ where: { datasetId: dataset.id }, data: { expiresAt: new Date(Date.now() + LEASE_MS) } });
          return false;
        }
        if (job.cursor !== job.targetSequence) throw new Error("AGGREGATION_SEQUENCE_GAP");
        await tx.marketAggregationGeneration.updateMany({ where: { datasetId: dataset.id, status: "READY", id: { not: job.generation.id } }, data: { status: "RETIRED" } });
        await tx.marketAggregationGeneration.update({ where: { id: job.generation.id }, data: { status: "READY" } });
        await tx.marketDataset.update({ where: { id: dataset.id }, data: { activeAggregationId: job.generation.id } });
        await tx.marketAggregationJob.update({ where: { id: jobId }, data: { status: "COMPLETED", activeDatasetId: null, workerToken: null, leaseUntil: null } });
        return true;
      }, { maxWait: 30000, timeout: 30000 });
      if (finished) break;
      await hooks?.afterBatch?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await cleanRetiredGenerations(initial.datasetId).catch((error) => console.warn("aggregation-cleanup", error));
  } catch (error) {
    if (claimed) await prisma.marketAggregationJob.updateMany({ where: { id: jobId, workerToken: token }, data: {
      status: "FAILED", activeDatasetId: null, workerToken: null, leaseUntil: null,
      error: error instanceof Error ? error.message : copy.marketReplay.aggregation.failed,
    } });
    throw error;
  } finally {
    clearInterval(timer);
    // A duplicate worker must not release the lease of the actual owner.
    if (leaseAcquired) await releaseDatasetLease(initial.datasetId, owner);
  }
}
