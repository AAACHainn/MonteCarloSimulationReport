import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { SyncError } from "./security";
import { randomUUID } from "node:crypto";
export const LEASE_MS = 120000;
type LeaseDb = Prisma.TransactionClient | PrismaClient;
export async function acquireDatasetLease(db: LeaseDb, datasetId: string, owner: string, now = new Date()) {
  await db.marketDatasetUpdateLease.upsert({ where: { datasetId }, create: { datasetId, owner: "", expiresAt: new Date(0) }, update: {} });
  const claimed = await db.marketDatasetUpdateLease.updateMany({ where: { datasetId, OR: [{ owner }, { expiresAt: { lte: now } }] }, data: { owner, expiresAt: new Date(now.getTime() + LEASE_MS) } });
  if (!claimed.count) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
}
export async function assertDatasetIdle(datasetId: string) {
  const lease = await prisma.marketDatasetUpdateLease.findUnique({ where: { datasetId } });
  if (lease && lease.expiresAt > new Date()) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
  const active = await prisma.marketDataSyncRun.findFirst({ where: { datasetId, status: { in: ["QUEUED", "RUNNING", "INTERRUPTED"] } } });
  if (active) throw new SyncError(copy.marketSync.busy, 409, "BUSY");
}
export async function releaseDatasetLease(datasetId: string, owner: string) { await prisma.marketDatasetUpdateLease.deleteMany({ where: { datasetId, owner } }); }
export async function withDatasetUpdate<T>(datasetId: string, action: () => Promise<T>): Promise<T> {
  const owner = `metadata_${randomUUID()}`;
  await assertDatasetIdle(datasetId);
  await acquireDatasetLease(prisma, datasetId, owner);
  const timer = setInterval(() => { void prisma.marketDatasetUpdateLease.updateMany({ where: { datasetId, owner }, data: { expiresAt: new Date(Date.now() + LEASE_MS) } }).catch(() => undefined); }, 20000);
  try { return await action(); }
  finally { clearInterval(timer); await releaseDatasetLease(datasetId, owner); }
}
