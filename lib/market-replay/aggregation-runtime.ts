import { prisma } from "@/lib/db";
import { aggregationOwner, recoverAggregationJobs } from "@/lib/market-sync/lease";
import { startAggregationWorker } from "./aggregation-worker";

type Runtime = { tick: () => Promise<void>; stop: () => void };
const globals = globalThis as unknown as { aggregationRuntime?: Runtime };

/** Pure discovery: polling an idle queue never writes a lease/heartbeat. */
export async function aggregationDispatchCandidate() {
  const running = await prisma.marketAggregationJob.findMany({ where: { status: "RUNNING" } });
  let expired = false, active = false;
  for (const job of running) {
    const lease = await prisma.marketDatasetUpdateLease.findUnique({ where: { datasetId: job.datasetId } });
    const now = new Date();
    if (job.workerToken && job.leaseUntil && job.leaseUntil > now && lease?.expiresAt && lease.expiresAt > now
      && lease.owner === aggregationOwner(job.id, job.workerToken)) active = true;
    else expired = true;
  }
  if (expired) active = await recoverAggregationJobs();
  if (active) return null;
  const queued = await prisma.marketAggregationJob.findMany({ where: { status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  for (const job of queued) {
    const lease = await prisma.marketDatasetUpdateLease.findUnique({ where: { datasetId: job.datasetId } });
    if (!lease || lease.expiresAt <= new Date()) return job;
  }
  return null;
}

export function startAggregationRuntime() {
  if (globals.aggregationRuntime || process.env.NEXT_PHASE === "phase-production-build" || process.env.VITEST) return globals.aggregationRuntime;
  let checking = false, stopped = false;
  const children = new Set<string>();
  const retries = new Map<string, { attempts: number; after: number }>();
  function backoff(identity: string) {
    const attempts = (retries.get(identity)?.attempts ?? 0) + 1;
    retries.set(identity, { attempts, after: Date.now() + Math.min(60000, 5000 * 2 ** Math.min(attempts - 1, 4)) });
  }
  async function tick() {
    if (checking || stopped) return;
    checking = true;
    try {
      const job = await aggregationDispatchCandidate();
      if (!job) return;
      for (const [key, retry] of retries) if (retry.after < Date.now() - 600000) retries.delete(key);
      const identity = job.id + ":" + job.workerToken;
      if (children.has(identity) || (retries.get(identity)?.after ?? 0) > Date.now()) return;
      children.add(identity);
      try {
        const child = startAggregationWorker(job.id, job.workerToken);
        const finished = (code: number | null) => {
          children.delete(identity);
          void (async () => {
            const current = await prisma.marketAggregationJob.findUnique({ where: { id: job.id } });
            if (code !== 0 || (current?.status === "QUEUED" && current.workerToken === job.workerToken)) backoff(identity);
            else { retries.delete(identity); if (!stopped) await tick(); }
          })().catch(() => backoff(identity));
        };
        child.once("exit", finished);
        child.once("error", () => {
          children.delete(identity); backoff(identity);
          console.warn(JSON.stringify({ event: "aggregation-dispatch", stage: "spawn", jobId: job.id }));
        });
      } catch {
        children.delete(identity); backoff(identity);
        console.warn(JSON.stringify({ event: "aggregation-dispatch", stage: "spawn", jobId: job.id }));
      }
    } catch { console.warn(JSON.stringify({ event: "aggregation-dispatch", stage: "poll" })); }
    finally { checking = false; }
  }
  const timer = setInterval(() => void tick(), 5000); timer.unref();
  const stop = () => {
    stopped = true; clearInterval(timer);
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  globals.aggregationRuntime = { tick, stop }; void tick();
  return globals.aggregationRuntime;
}

export function wakeAggregationQueue() { void startAggregationRuntime()?.tick(); }
