import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { MarketBar, MarketDataset, MarketDataSyncRun } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { MARKET_BAR_BLOCK_SIZES, MAX_MARKET_BARS } from "@/lib/market-replay/types";
import { addToBlock, type BlockAccumulator } from "@/lib/market-replay/import-file";
import { budgetDay } from "./schedule";
import { acquireDatasetLease, LEASE_MS, releaseDatasetLease } from "./lease";
import { DatabentoProvider, type MarketProvider } from "./databento";
import { decryptKey, SyncError } from "./security";
import { syncConfigSchema, type Charge, type SyncBar, type SyncSettings } from "./types";

const DAY = 86400000;
const BATCH = 2048;
function sameBar(a: Pick<MarketBar, "open" | "high" | "low" | "close" | "volume">, b: SyncBar) {
  return (["open", "high", "low", "close", "volume"] as const).every((key) => a[key] === b[key]);
}
async function reserveCost(runId: string, settings: SyncSettings, cost: number, owner: string) {
  await prisma.$transaction(async (tx) => {
    const run = await tx.marketDataSyncRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.leaseOwner !== owner) throw new SyncError(copy.marketSync.interrupted, 409, "LEASE");
    const now = new Date(); const today = budgetDay(now, settings.schedule.timezone);
    const recent = await tx.marketDataSyncRun.findMany({ where: { datasetId: run.datasetId, updatedAt: { gte: new Date(now.getTime() - 2 * DAY) } }, select: { charges: true } });
    const spent = recent.flatMap((v) => JSON.parse(v.charges) as Charge[]).filter((v) => budgetDay(new Date(v.at), settings.schedule.timezone) === today).reduce((sum, v) => sum + v.cost, 0);
    // Round upward to micro-dollars to avoid floating point under-reservation.
    const reserved = Math.ceil(cost * 1e6) / 1e6;
    if (run.estimatedCost + reserved > settings.perRunBudget + 1e-9 || spent + reserved > settings.dailyBudget + 1e-9) throw new SyncError(copy.marketSync.budget, 400, "BUDGET");
    const charges = JSON.parse(run.charges) as Charge[]; charges.push({ at: now.toISOString(), cost: reserved });
    await tx.marketDataSyncRun.update({ where: { id: runId }, data: { estimatedCost: { increment: reserved }, charges: JSON.stringify(charges) } });
  });
}
async function heartbeat(run: MarketDataSyncRun, owner: string, controller: AbortController) {
  try {
    const now = new Date(); const until = new Date(now.getTime() + LEASE_MS);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.marketDataSyncRun.updateMany({ where: { id: run.id, leaseOwner: owner, status: "RUNNING" }, data: { leaseUntil: until } });
      const lease = await tx.marketDatasetUpdateLease.updateMany({ where: { datasetId: run.datasetId, owner: run.id }, data: { expiresAt: until } });
      if (!claimed.count || !lease.count) throw new Error("Lease lost");
    });
  } catch { controller.abort(); }
}
async function publishSegment(run: MarketDataSyncRun, owner: string, target: MarketDataset, stagingId: string, count: number, last: Date | null, through: Date, mappings: Record<string, string>) {
  await prisma.$transaction(async (tx) => {
    const currentRun = await tx.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    const current = await tx.marketDataset.findUniqueOrThrow({ where: { id: target.id } });
    const lease = await tx.marketDatasetUpdateLease.findUnique({ where: { datasetId: target.id } });
    if (!lease || lease.owner !== run.id || lease.expiresAt <= new Date() || !currentRun.leaseUntil || currentRun.leaseUntil <= new Date()) throw new SyncError(copy.marketSync.interrupted, 409, "LEASE");
    if (currentRun.leaseOwner !== owner || currentRun.status !== "RUNNING" || current.dataVersion !== target.dataVersion || current.barCount !== target.barCount) throw new SyncError(copy.marketSync.changed, 409, "CHANGED");
    if (count) {
      await tx.marketBar.updateMany({ where: { datasetId: stagingId }, data: { datasetId: target.id } });
      // Rebuild only the old partial block and the new tail, in bounded batches.
      for (const blockSize of MARKET_BAR_BLOCK_SIZES) {
        const start = Math.floor(target.barCount / blockSize) * blockSize;
        await tx.marketBarBlock.deleteMany({ where: { datasetId: target.id, blockSize, startSequence: { gte: start } } });
        for (let from = start; from < target.barCount + count; from += 16384) {
          const bars = await tx.marketBar.findMany({ where: { datasetId: target.id, sequence: { gte: from, lt: Math.min(from + 16384, target.barCount + count) } }, orderBy: { sequence: "asc" } });
          let block: BlockAccumulator | null = null;
          const blocks: Array<BlockAccumulator & { datasetId: string; blockSize: number }> = [];
          for (const bar of bars) {
            block = addToBlock(block, bar);
            if (block.barCount === blockSize) { blocks.push({ ...block, datasetId: target.id, blockSize }); block = null; }
          }
          if (block) blocks.push({ ...block, datasetId: target.id, blockSize });
          if (blocks.length) await tx.marketBarBlock.createMany({ data: blocks });
        }
        const state = await tx.marketBarBlockBuildState.findUnique({ where: { datasetId_blockSize: { datasetId: target.id, blockSize } } });
        if ((state?.cursor ?? -1) >= target.barCount - 1) await tx.marketBarBlockBuildState.update({ where: { datasetId_blockSize: { datasetId: target.id, blockSize } }, data: { cursor: target.barCount + count - 1 } });
      }
      await tx.marketDataset.update({ where: { id: target.id }, data: { barCount: { increment: count }, endTime: last!, dataVersion: { increment: 1 }, ...(target.barBlockBuildCursor >= target.barCount - 1 ? { barBlockBuildCursor: target.barCount + count - 1 } : {}) } });
    }
    await tx.marketDatasetSyncConfig.update({ where: { datasetId: target.id }, data: { checkedThrough: through, verified: true } });
    await tx.marketDataSyncRun.update({ where: { id: run.id }, data: { cursor: through, addedBars: { increment: count }, mappings: JSON.stringify(mappings) } });
    await tx.marketDataset.delete({ where: { id: stagingId } });
  }, { maxWait: 30000, timeout: 120000 });
}
async function downloadSegment(provider: MarketProvider, settings: SyncSettings, run: MarketDataSyncRun, owner: string, start: Date, end: Date, signal: AbortSignal, initialBinding: boolean) {
  const stagingId = `market_sync_${run.id}_${owner}`;
  for (let attempt = 0; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    const target = await prisma.marketDataset.findUniqueOrThrow({ where: { id: run.datasetId } });
    await prisma.marketDataset.deleteMany({ where: { id: stagingId, status: "IMPORTING" } });
    await prisma.marketDataset.create({ data: { id: stagingId, name: "sync staging", symbol: target.symbol, timeframe: target.timeframe, timezone: target.timezone, sourceIntervalSeconds: target.sourceIntervalSeconds, status: "IMPORTING", barCount: 0, startTime: start, endTime: end } });
    try {
      const cost = await provider.cost(settings.profile, start, end, signal);
      await reserveCost(run.id, settings, cost, owner);
      await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { stage: "DOWNLOADING" } });
      let pending: SyncBar[] = []; let count = 0; let last: Date | null = null; let previous: SyncBar | null = null; let matched = 0;
      const mappings = JSON.parse((await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).mappings) as Record<string, string>;
      const conflicts: Array<{ time: string; local: unknown; remote: unknown }> = [];
      const flush = async () => {
        if (!pending.length) return;
        signal.throwIfAborted();
        const existing = await prisma.marketBar.findMany({ where: { datasetId: target.id, timestamp: { gte: pending[0].timestamp, lte: pending.at(-1)!.timestamp } } });
        const local = new Map(existing.map((bar) => [bar.timestamp.getTime(), bar]));
        const additions: Array<Omit<MarketBar, "datasetId"> & { datasetId: string }> = [];
        for (const bar of pending) {
          const stored = local.get(bar.timestamp.getTime());
          if (bar.timestamp <= target.endTime) {
            if (stored && sameBar(stored, bar)) matched++;
            else if (conflicts.length < 20) conflicts.push({ time: bar.timestamp.toISOString(), local: stored ? { open: stored.open, high: stored.high, low: stored.low, close: stored.close, volume: stored.volume } : null, remote: bar });
          } else {
            if (target.barCount + count >= MAX_MARKET_BARS) throw new SyncError(copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS), 400, "DATA");
            additions.push({ datasetId: stagingId, sequence: target.barCount + count++, timestamp: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }); last = bar.timestamp;
          }
          const day = bar.timestamp.toISOString().slice(0, 10);
          if (mappings[day] && mappings[day] !== bar.symbol) throw new SyncError(copy.marketSync.conflict, 400, "CONFLICT");
          mappings[day] = bar.symbol;
        }
        if (additions.length) await prisma.marketBar.createMany({ data: additions });
        pending = [];
      };
      for await (const bar of provider.bars(settings.profile, start, end, signal)) {
        if (previous && bar.timestamp <= previous.timestamp) {
          if (bar.timestamp.getTime() === previous.timestamp.getTime() && sameBar(previous, bar) && previous.symbol === bar.symbol) continue;
          throw new SyncError(copy.marketSync.invalid, 400, "DATA");
        }
        previous = bar; pending.push(bar); if (pending.length >= BATCH) await flush();
      }
      await flush();
      await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { stage: "VALIDATING" } });
      // Compare both directions: a local record missing remotely is also a revision.
      const localCount = await prisma.marketBar.count({ where: { datasetId: target.id, timestamp: { gte: start, lt: end, lte: target.endTime } } });
      if (conflicts.length || matched !== localCount || (initialBinding && end > target.endTime && matched === 0)) {
        await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { conflicts: JSON.stringify(conflicts.length ? conflicts : [{ time: start.toISOString(), localCount, matched }]) } });
        throw new SyncError(copy.marketSync.conflict, 400, "CONFLICT");
      }
      signal.throwIfAborted();
      await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { stage: "PUBLISHING" } });
      await publishSegment(run, owner, target, stagingId, count, last, end, mappings);
      return;
    } catch (error) {
      await prisma.marketDataset.deleteMany({ where: { id: stagingId, status: "IMPORTING" } });
      const retryable = !(error instanceof SyncError) || error.status === 429 || error.status >= 500;
      if (signal.aborted || !retryable || attempt === 3) throw error;
      const retryAfter = (error as { retryAfter?: number }).retryAfter ?? 1000 * 2 ** attempt;
      await delay(Math.max(0, retryAfter), undefined, { signal });
    }
  }
}
export async function executeSyncRun(runId: string, externalSignal: AbortSignal, providerOverride?: MarketProvider, workerOwner = randomUUID()) {
  const controller = new AbortController(); const signal = AbortSignal.any([externalSignal, controller.signal]);
  let diagnostic: { errorCode?: string; httpStatus?: number; providerMethod?: string; providerCase?: string | null } = {};
  let run = await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: runId } });
  const claimed = await prisma.marketDataSyncRun.updateMany({ where: { id: runId, OR: [{ status: { in: ["QUEUED", "INTERRUPTED"] } }, { status: "RUNNING", leaseUntil: { lte: new Date() } }] }, data: { status: "RUNNING", stage: "CHECKING", error: null, leaseOwner: workerOwner, leaseUntil: new Date(Date.now() + LEASE_MS) } });
  if (!claimed.count) return;
  const timer = setInterval(() => void heartbeat(run, workerOwner, controller), 20000); timer.unref();
  try {
    await acquireDatasetLease(prisma, run.datasetId, run.id);
    // Fenced owners use distinct staging IDs; stale workers cannot delete a successor's tail.
    await prisma.marketDataset.deleteMany({ where: { id: { startsWith: `market_sync_${run.id}_` }, status: "IMPORTING" } });
    const settings = syncConfigSchema.parse(JSON.parse(run.configSnapshot));
    const config = await prisma.marketDatasetSyncConfig.findUniqueOrThrow({ where: { datasetId: run.datasetId } });
    const target = await prisma.marketDataset.findUniqueOrThrow({ where: { id: run.datasetId } });
    if (config.profile !== JSON.stringify(settings.profile) || target.sourceIntervalSeconds !== settings.profile.interval) throw new SyncError(copy.marketSync.changed, 409, "CHANGED");
    let provider = providerOverride;
    if (!provider) {
      const connection = await prisma.marketDataConnection.findUnique({ where: { id: "databento" } });
      if (!connection || connection.status !== "CONNECTED") throw new SyncError(copy.marketSync.noConnection, 400, "AUTH");
      provider = new DatabentoProvider(decryptKey(connection.encryptedKey));
    }
    const range = await provider.range(settings.profile, signal);
    const step = settings.profile.interval * 1000;
    if (!Number.isFinite(range.start.getTime()) || !Number.isFinite(range.end.getTime()) || range.start >= range.end) throw new SyncError(copy.marketSync.unavailable, 400, "RANGE");
    const end = new Date(Math.floor(Math.min(Date.now(), range.end.getTime()) / step) * step);
    await prisma.marketDatasetSyncConfig.update({ where: { datasetId: run.datasetId }, data: { lastCheckedAt: new Date(), availableThrough: end } });
    // Persisted targets describe an earlier check. Re-check on every execution and
    // cap resumed requests too, so a changed key or entitlement cannot cause overshoot.
    const fixedEnd = new Date(Math.min(run.requestEnd?.getTime() ?? end.getTime(), end.getTime()));
    console.info(JSON.stringify({ event: "market-sync-range", runId: run.id, datasetId: run.datasetId, intervalSeconds: settings.profile.interval, availableStart: range.start.toISOString(), availableEnd: range.end.toISOString(), completeBefore: end.toISOString(), requestEnd: fixedEnd.toISOString() }));
    let start = run.cursor ?? run.requestStart;
    if (!start) {
      const cursor = config.checkedThrough ?? new Date(target.endTime.getTime() + step);
      if (config.verified && !config.pausedReason && end <= cursor) {
        await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { status: "COMPLETED", leaseOwner: null, leaseUntil: null } });
        return;
      }
      if (config.verified) start = new Date(cursor.getTime() - DAY);
      else {
        const lastDay = new Date(Math.floor(target.endTime.getTime() / DAY) * DAY);
        const prior = await prisma.marketBar.findFirst({ where: { datasetId: target.id, timestamp: { lt: lastDay } }, orderBy: { timestamp: "desc" }, select: { timestamp: true } });
        start = prior ? new Date(Math.floor(prior.timestamp.getTime() / DAY) * DAY) : target.startTime;
      }
      start = new Date(Math.max(start.getTime(), target.startTime.getTime()));
    }
    // A crash after the last published segment needs only finalization, not a download.
    if (run.cursor && run.requestEnd && run.cursor >= run.requestEnd) {
      await prisma.marketDatasetSyncConfig.update({ where: { datasetId: run.datasetId }, data: { pausedReason: null } });
      await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { status: "COMPLETED", leaseOwner: null, leaseUntil: null } });
      return;
    }
    if (start < range.start || fixedEnd <= start) throw new SyncError(copy.marketSync.unavailable, 400, "RANGE");
    await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { requestStart: run.requestStart ?? start, requestEnd: fixedEnd, cursor: start } });
    let segmentStart: Date = start!;
    let initialBinding = !config.verified;
    while (segmentStart < fixedEnd) {
      signal.throwIfAborted();
      const segmentEnd: Date = new Date(Math.min(fixedEnd.getTime(), (Math.floor(segmentStart.getTime() / DAY) + 1) * DAY));
      const conditions = await provider.conditions(segmentStart, segmentEnd, signal);
      const condition = conditions.find((v) => v.date === segmentStart.toISOString().slice(0, 10));
      if (!condition || condition.condition !== "available") throw new SyncError(copy.marketSync.quality, 400, "QUALITY");
      await downloadSegment(provider, settings, run, workerOwner, segmentStart, segmentEnd, signal, initialBinding);
      // publishSegment persists the successful binding. Later UTC days can contain
      // entirely new bars and must not be required to match existing history again.
      initialBinding = false;
      segmentStart = segmentEnd;
    }
    await prisma.marketDatasetSyncConfig.update({ where: { datasetId: run.datasetId }, data: { pausedReason: null } });
    await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { status: "COMPLETED", leaseOwner: null, leaseUntil: null } });
  } catch (error) {
    const interrupted = signal.aborted;
    const reason = interrupted ? copy.marketSync.interrupted : error instanceof SyncError ? error.message : copy.marketSync.failed;
    const code = error instanceof SyncError ? error.code : "ERROR";
    diagnostic = { errorCode: code, ...(error instanceof SyncError ? { httpStatus: error.status, providerMethod: error.provider?.method, providerCase: error.provider?.case } : {}) };
    const blocked = ["CONFLICT", "BUDGET", "AUTH", "QUALITY", "RANGE", "DATA", "CHANGED"].includes(code) || (error instanceof SyncError && error.code === "HTTP" && error.status < 500 && error.status !== 429);
    await prisma.marketDataSyncRun.updateMany({ where: { id: run.id, leaseOwner: workerOwner }, data: { status: interrupted ? "INTERRUPTED" : blocked ? "BLOCKED" : "FAILED", error: reason, leaseOwner: null, leaseUntil: null } });
    if (!interrupted && blocked) await prisma.marketDatasetSyncConfig.updateMany({ where: { datasetId: run.datasetId }, data: { pausedReason: reason } });
  } finally {
    clearInterval(timer);
    run = await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: runId } });
    if (!run.leaseOwner || run.leaseOwner === workerOwner) await releaseDatasetLease(run.datasetId, run.id);
    console.info(JSON.stringify({ event: "market-sync", runId, datasetId: run.datasetId, status: run.status, addedBars: run.addedBars, estimatedCost: run.estimatedCost, ...diagnostic }));
  }
}
