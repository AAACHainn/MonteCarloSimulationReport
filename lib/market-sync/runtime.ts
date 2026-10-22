import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { nextScheduledAt } from "./schedule";
import { enqueueSync } from "./service";
import { executeSyncRun } from "./engine";
import type { SyncSchedule } from "./types";

type Runtime = { tick: () => Promise<void>; stop: () => void };
const globals = globalThis as unknown as { marketSyncRuntime?: Runtime };
export function startMarketSyncRuntime() {
  if (globals.marketSyncRuntime || process.env.MARKET_DATA_SYNC_ENABLED === "0" || process.env.NEXT_PHASE === "phase-production-build" || process.env.VITEST) return globals.marketSyncRuntime;
  const owner = randomUUID(); const controller = new AbortController(); let checking = false; let running = false; let jobController: AbortController | null = null;
  async function tick() {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      const now = new Date();
      if (!running) {
        const [due, pending] = await Promise.all([
          prisma.marketDatasetSyncConfig.findFirst({ where: { mode: "AUTO", pausedReason: null, nextRunAt: { lte: now } }, select: { datasetId: true } }),
          prisma.marketDataSyncRun.findFirst({ where: { OR: [{ status: { in: ["QUEUED", "INTERRUPTED"] } }, { status: "RUNNING", leaseUntil: { lte: now } }] }, select: { id: true } }),
        ]);
        if (!due && !pending) return;
      }
      await prisma.marketSyncSchedulerLease.upsert({ where: { id: "dispatcher" }, create: { id: "dispatcher", owner: "", expiresAt: new Date(0), heartbeat: now }, update: {} });
      const elected = await prisma.marketSyncSchedulerLease.updateMany({ where: { id: "dispatcher", OR: [{ owner }, { expiresAt: { lte: now } }] }, data: { owner, heartbeat: now, expiresAt: new Date(now.getTime() + 45000) } });
      if (!elected.count) { jobController?.abort(); return; }
      const configs = await prisma.marketDatasetSyncConfig.findMany({ where: { mode: "AUTO", pausedReason: null, nextRunAt: { lte: now } } });
      for (const config of configs) {
        try {
          await enqueueSync(config.datasetId, "SCHEDULED");
          await prisma.marketDatasetSyncConfig.updateMany({ where: { datasetId: config.datasetId, nextRunAt: config.nextRunAt, mode: "AUTO" }, data: { nextRunAt: nextScheduledAt(JSON.parse(config.schedule) as SyncSchedule, now) } });
        } catch { /* An import may own this dataset; leave its schedule due. */ }
      }
      if (running) return;
      const run = await prisma.marketDataSyncRun.findFirst({ where: { OR: [{ status: { in: ["QUEUED", "INTERRUPTED"] } }, { status: "RUNNING", leaseUntil: { lte: now } }] }, orderBy: { createdAt: "asc" } });
      if (run) {
        running = true;
        jobController = new AbortController();
        void executeSyncRun(run.id, AbortSignal.any([controller.signal, jobController.signal]), undefined, owner).catch(() => console.error(JSON.stringify({ event: "market-sync-worker", status: "error", runId: run.id }))).finally(() => { running = false; jobController = null; });
      }
    } catch { console.error(JSON.stringify({ event: "market-sync-dispatcher", status: "unavailable" })); }
    finally { checking = false; }
  }
  const timer = setInterval(() => void tick(), 15000); timer.unref();
  const stop = () => { clearInterval(timer); controller.abort(); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  globals.marketSyncRuntime = { tick, stop }; void tick();
  return globals.marketSyncRuntime;
}
