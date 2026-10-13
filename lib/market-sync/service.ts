import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { decryptKey, encryptKey, encryptionReady, SyncError } from "./security";
import { DatabentoProvider } from "./databento";
import { defaultSchedule, syncConfigSchema, type SyncConfigView, type SyncSettings } from "./types";
import { nextScheduledAt } from "./schedule";
import { acquireDatasetLease, assertDatasetIdle, releaseDatasetLease } from "./lease";
import type { MarketDataSyncRun } from "@prisma/client";

export function runView(run: MarketDataSyncRun) { return { id: run.id, status: run.status, stage: run.stage, addedBars: run.addedBars, estimatedCost: run.estimatedCost, error: run.error, conflicts: run.conflicts, updatedAt: run.updatedAt.toISOString() }; }
export async function getConnection() {
  const connection = await prisma.marketDataConnection.findUnique({ where: { id: "databento" } });
  return { configured: Boolean(connection), encryptionReady: encryptionReady(), suffix: connection?.keySuffix ?? null, status: connection?.status ?? "UNCONFIGURED", testedAt: connection?.testedAt?.toISOString() ?? null, error: connection?.error ?? null };
}
export async function saveConnection(input: unknown) {
  const key = typeof input === "object" && input && "apiKey" in input ? String(input.apiKey).trim() : "";
  if (!/^[\x21-\x7E]{12,256}$/.test(key)) throw new SyncError(copy.marketSync.keyInvalid);
  const encryptedKey = encryptKey(key);
  await prisma.marketDataConnection.upsert({ where: { id: "databento" }, create: { encryptedKey, keySuffix: key.slice(-4) }, update: { encryptedKey, keySuffix: key.slice(-4), keyVersion: { increment: 1 }, status: "UNTESTED", testedAt: null, error: null } });
  return getConnection();
}
export async function testConnection() {
  const connection = await prisma.marketDataConnection.findUnique({ where: { id: "databento" } });
  if (!connection) throw new SyncError(copy.marketSync.noConnection);
  try {
    await new DatabentoProvider(decryptKey(connection.encryptedKey)).range({ root: "ES", contractMode: "CONTINUOUS", contract: "", interval: 60 }, AbortSignal.timeout(30000));
    await prisma.marketDataConnection.updateMany({ where: { id: connection.id, keyVersion: connection.keyVersion }, data: { status: "CONNECTED", testedAt: new Date(), error: null } });
  } catch (error) {
    await prisma.marketDataConnection.updateMany({ where: { id: connection.id, keyVersion: connection.keyVersion }, data: { status: "ERROR", testedAt: new Date(), error: error instanceof SyncError ? error.message : copy.marketSync.failed } });
  }
  return getConnection();
}
export async function configView(datasetId: string): Promise<SyncConfigView> {
  const dataset = await prisma.marketDataset.findUnique({ where: { id: datasetId } });
  if (!dataset) throw new SyncError(copy.marketSync.missing, 404);
  const config = await prisma.marketDatasetSyncConfig.findUnique({ where: { datasetId } });
  const latest = await prisma.marketDataSyncRun.findFirst({ where: { datasetId }, orderBy: { createdAt: "desc" } });
  return { mode: (config?.mode ?? "OFF") as SyncSettings["mode"], profile: config ? JSON.parse(config.profile) : { root: dataset.symbol.toUpperCase(), contractMode: "CONTINUOUS", contract: "", interval: dataset.sourceIntervalSeconds ?? 60 }, schedule: config ? JSON.parse(config.schedule) : defaultSchedule(), perRunBudget: config?.perRunBudget ?? 0, dailyBudget: config?.dailyBudget ?? 0, nextRunAt: config?.nextRunAt?.toISOString() ?? null, lastCheckedAt: config?.lastCheckedAt?.toISOString() ?? null, pausedReason: config?.pausedReason ?? null, availableThrough: config?.availableThrough?.toISOString() ?? null, active: Boolean(latest && ["QUEUED", "RUNNING", "INTERRUPTED"].includes(latest.status)), latestRun: latest ? runView(latest) : null };
}
export async function saveConfig(datasetId: string, input: unknown) {
  if (typeof input === "object" && input && "mode" in input && input.mode === "OFF") {
    const dataset = await prisma.marketDataset.findUnique({ where: { id: datasetId } });
    if (!dataset || dataset.status !== "READY") throw new SyncError(copy.marketSync.missing, 404);
    await prisma.marketDatasetSyncConfig.updateMany({ where: { datasetId }, data: { mode: "OFF", nextRunAt: null } });
    return configView(datasetId);
  }
  const parsed = syncConfigSchema.safeParse(input);
  if (!parsed.success) throw new SyncError(copy.marketSync.invalid);
  const settings = parsed.data;
  const dataset = await prisma.marketDataset.findUnique({ where: { id: datasetId } });
  if (!dataset || dataset.status !== "READY") throw new SyncError(copy.marketSync.missing, 404);
  const current = await prisma.marketDatasetSyncConfig.findUnique({ where: { datasetId } });
  const profile = JSON.stringify(settings.profile);
  if (settings.mode !== "OFF") {
    if (settings.profile.interval !== dataset.sourceIntervalSeconds || (settings.profile.contractMode === "CONTINUOUS" ? settings.profile.root !== dataset.symbol.toUpperCase() : ![settings.profile.root, settings.profile.contract].includes(dataset.symbol.toUpperCase()))) throw new SyncError(copy.marketSync.unsupported);
    const connection = await getConnection();
    if (!connection.configured || connection.status !== "CONNECTED") throw new SyncError(copy.marketSync.noConnection);
  }
  const changed = current?.profile !== profile;
  if (changed) await assertDatasetIdle(datasetId);
  const scheduleChanged = !current || JSON.stringify({ ...JSON.parse(current.schedule), anchor: "" }) !== JSON.stringify({ ...settings.schedule, anchor: "" });
  const schedule = { ...settings.schedule, anchor: scheduleChanged ? new Date().toISOString() : JSON.parse(current!.schedule).anchor };
  const next = settings.mode === "AUTO" ? (!scheduleChanged && current?.mode === "AUTO" ? current.nextRunAt : nextScheduledAt(schedule, new Date())) : null;
  await prisma.marketDatasetSyncConfig.upsert({ where: { datasetId }, create: { datasetId, mode: settings.mode, profile, schedule: JSON.stringify(schedule), perRunBudget: settings.perRunBudget, dailyBudget: settings.dailyBudget, nextRunAt: next }, update: { mode: settings.mode, profile, schedule: JSON.stringify(schedule), perRunBudget: settings.perRunBudget, dailyBudget: settings.dailyBudget, nextRunAt: next, ...(changed ? { verified: false, checkedThrough: null, pausedReason: null } : current.pausedReason !== copy.marketSync.conflict ? { pausedReason: null } : {}) } });
  return configView(datasetId);
}
export async function enqueueSync(datasetId: string, trigger = "MANUAL") {
  return prisma.$transaction(async (tx) => {
    const config = await tx.marketDatasetSyncConfig.findUnique({ where: { datasetId } });
    if (!config || config.mode === "OFF") throw new SyncError(copy.marketSync.disabled);
    const active = await tx.marketDataSyncRun.findFirst({ where: { datasetId, status: { in: ["QUEUED", "RUNNING", "INTERRUPTED"] } } });
    if (active) return runView(active);
    await acquireDatasetLease(tx, datasetId, "enqueue");
    const run = await tx.marketDataSyncRun.create({ data: { datasetId, trigger, configSnapshot: JSON.stringify({ mode: config.mode, profile: JSON.parse(config.profile), schedule: JSON.parse(config.schedule), perRunBudget: config.perRunBudget, dailyBudget: config.dailyBudget }) } });
    await tx.marketDatasetUpdateLease.update({ where: { datasetId }, data: { owner: run.id } });
    return runView(run);
  });
}
export async function releaseRun(run: MarketDataSyncRun) { await releaseDatasetLease(run.datasetId, run.id); }
