import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { SyncError } from "./security";
import { randomUUID } from "node:crypto";
import { backgroundWritePolicy, retrySqliteWrite, sqliteWriteTransaction } from "@/lib/sqlite-write";
export const LEASE_MS = 120000;
type LeaseDb = Prisma.TransactionClient | PrismaClient;
export function activeAggregationJob(db: LeaseDb, datasetId: string) {
  // A queued reservation has no execution timeout. Reads must never reclaim jobs.
  return db.marketAggregationJob.findUnique({ where: { activeDatasetId: datasetId } });
}
export const aggregationOwner = (jobId: string, token: string) => `aggregation_${jobId}_${token}`;

/** Caller already owns SQLite's write slot. Check both leases using time after lock acquisition. */
export async function reclaimAggregationJobs(tx: Prisma.TransactionClient) {
  const jobs = await tx.marketAggregationJob.findMany({ where: { status: "RUNNING" } });
  let running = false;
  for (const job of jobs) {
    const lease = await tx.marketDatasetUpdateLease.findUnique({ where: { datasetId: job.datasetId } });
    const now = new Date();
    const owner = job.workerToken ? aggregationOwner(job.id, job.workerToken) : null;
    if (owner && job.leaseUntil && job.leaseUntil > now && lease?.owner === owner && lease.expiresAt > now) {
      running = true;
      continue;
    }
    const changed = await tx.marketAggregationJob.updateMany({
      where: { id: job.id, status: "RUNNING", workerToken: job.workerToken, updatedAt: job.updatedAt },
      data: { status: "INTERRUPTED", activeDatasetId: null, workerToken: null, leaseUntil: null },
    });
    if (changed.count && owner && lease?.owner === owner && lease.expiresAt <= now) {
      await tx.marketDatasetUpdateLease.deleteMany({ where: { datasetId: job.datasetId, owner, expiresAt: { lte: now } } });
    }
  }
  return running;
}

export function recoverAggregationJobs() {
  return sqliteWriteTransaction(prisma, async (tx) => {
    await tx.$executeRaw`UPDATE "MarketAggregationJob" SET "status" = "status" WHERE "status" = 'RUNNING'`;
    return reclaimAggregationJobs(tx);
  }, undefined, backgroundWritePolicy);
}
export async function acquireDatasetLease(db: LeaseDb, datasetId: string, owner: string, now = new Date()) {
  const aggregation = await activeAggregationJob(db, datasetId);
  if (aggregation && !owner.startsWith(`aggregation_${aggregation.id}_`)) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
  await db.marketDatasetUpdateLease.upsert({ where: { datasetId }, create: { datasetId, owner: "", expiresAt: new Date(0) }, update: {} });
  const claimed = await db.marketDatasetUpdateLease.updateMany({ where: { datasetId, OR: [{ owner }, { expiresAt: { lte: now } }] }, data: { owner, expiresAt: new Date(now.getTime() + LEASE_MS) } });
  if (!claimed.count) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
}
export async function assertDatasetIdle(datasetId: string, db: LeaseDb = prisma) {
  if (await activeAggregationJob(db, datasetId)) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
  const lease = await db.marketDatasetUpdateLease.findUnique({ where: { datasetId } });
  if (lease && lease.expiresAt > new Date()) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
  const active = await db.marketDataSyncRun.findFirst({ where: { datasetId, status: { in: ["QUEUED", "RUNNING", "INTERRUPTED"] } } });
  if (active) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
}
export async function releaseDatasetLease(datasetId: string, owner: string) {
  await retrySqliteWrite(() => prisma.marketDatasetUpdateLease.deleteMany({ where: { datasetId, owner } }), backgroundWritePolicy);
}
export async function withDatasetUpdate<T>(datasetId: string, action: () => Promise<T>): Promise<T> {
  const owner = `metadata_${randomUUID()}`;
  await assertDatasetIdle(datasetId);
  await acquireDatasetLease(prisma, datasetId, owner);
  const timer = setInterval(() => { void prisma.marketDatasetUpdateLease.updateMany({ where: { datasetId, owner }, data: { expiresAt: new Date(Date.now() + LEASE_MS) } }).catch(() => undefined); }, 20000);
  try { return await action(); }
  finally { clearInterval(timer); await releaseDatasetLease(datasetId, owner); }
}
