import { fork, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../sqlite-client.mjs";

type Reply = { id?: number; event?: string; result?: unknown; error?: string; taskId?: string };
class Peer {
  readonly child: ChildProcess;
  private serial = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private events: Reply[] = [];
  private listeners = new Set<() => void>();
  private stderr = "";
  constructor(database: string) {
    this.child = fork(resolve("scripts/aggregation-concurrency-fixture.ts"), [], {
      execArgv: ["--import", "tsx"], silent: true,
      env: { ...process.env, DATABASE_URL: "file:" + database, SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", VITEST: "1", MARKET_DATA_SYNC_ENABLED: "0" },
    });
    this.child.stderr?.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-5000); });
    this.child.on("message", (message: Reply) => {
      if (message.event) { this.events.push(message); this.listeners.forEach((listener) => listener()); return; }
      const pending = this.pending.get(message.id!); this.pending.delete(message.id!);
      if (message.error) pending?.reject(new Error(message.error + "\n" + this.stderr)); else pending?.resolve(message.result);
    });
    this.child.on("exit", (code) => { this.pending.forEach((pending) => pending.reject(new Error(`Fixture exited (${code}): ${this.stderr}`))); this.pending.clear(); });
  }
  start(command: string, args: Record<string, unknown> = {}) {
    const id = ++this.serial;
    const promise = new Promise<unknown>((resolveReply, reject) => { this.pending.set(id, { resolve: resolveReply, reject }); });
    void promise.catch(() => undefined);
    this.child.send({ id, command, ...args });
    return { id, promise };
  }
  call(command: string, args: Record<string, unknown> = {}) { return this.start(command, args).promise; }
  release() { this.child.send({ command: "release" }); }
  event(name: string, id?: number) {
    return new Promise<Reply>((resolveEvent, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error(`Missing ${name}: ${this.stderr}`)); }, 30000);
      const check = () => {
        const index = this.events.findIndex((event) => event.event === name && (id === undefined || event.id === id));
        if (index < 0) return;
        const [event] = this.events.splice(index, 1); clearTimeout(timer); this.listeners.delete(check); resolveEvent(event);
      };
      this.listeners.add(check); check();
    });
  }
  async close() {
    if (!this.child.connected) return;
    const exited = new Promise<void>((resolveExit) => this.child.once("exit", () => resolveExit()));
    this.release(); await this.call("close"); await exited;
  }
}
const file = join(tmpdir(), "aggregation-concurrency-" + randomUUID() + ".db");
let client: ReturnType<typeof createDatabaseClient>;
let a: Peer, b: Peer, c: Peer, session: { sessionId: string; entryId: string };
const count = 50000;
beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: "file:" + file, SQLITE_DRIVER: "native", SQLITE_JOURNAL_MODE: "delete" }, stdio: "pipe" });
  client = createDatabaseClient({ datasourceUrl: "file:" + file }, { env: { SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal" } });
  const start = Date.parse("2026-10-19T22:00:00Z");
  for (const id of ["a", "b"]) {
    await client.marketDataset.create({ data: { id, name: id, symbol: "ES", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: count, startTime: new Date(start), endTime: new Date(start + (count - 1) * 60000) } });
    for (let offset = 0; offset < count; offset += 1000) await client.marketBar.createMany({ data: Array.from({ length: Math.min(1000, count - offset) }, (_, index) => ({ datasetId: id, sequence: offset + index, timestamp: new Date(start + (offset + index) * 60000), open: 100, high: 102, low: 99, close: 101, volume: 1 })) });
  }
  a = new Peer(file); b = new Peer(file); c = new Peer(file);
  await Promise.all([a.event("ready"), b.event("ready"), c.event("ready")]);
  session = await c.call("setup") as typeof session;
}, 60000);
afterAll(async () => {
  await Promise.allSettled([a?.close(), b?.close(), c?.close()]);
  await client?.$disconnect();
  rmSync(file, { force: true });

});

describe("real WAL connections and independent aggregation workers", () => {
  it("reproduces stale snapshots and retries only the rolled-back whole foreground transaction", async () => {
    const old = a.start("snapshot");
    await a.event("read", old.id); await b.call("checkpoint"); a.release();
    expect(await old.promise).toEqual({ busy: true });
    const fixed = a.start("snapshot", { retry: true });
    await a.event("read", fixed.id); await b.call("checkpoint"); a.release();
    expect(await fixed.promise).toEqual({ attempts: 2 });
    expect((await client.tradeDataset.findUniqueOrThrow({ where: { id: "journal-dataset" } })).name).toBe("snapshot-result");
  });
  it("allows one queued worker, keeps the other queued, and serves real foreground APIs during construction", async () => {
    const baseline: number[] = [];
    for (let index = 0; index < 5; index++) baseline.push(...await c.call("foreground", { ...session, index }) as number[]);
    const first = await a.call("queue", { datasetId: "a" }) as { id: string; workerToken: string };
    const second = await b.call("queue", { datasetId: "b" }) as { id: string; workerToken: string };
    const running = a.start("run", { jobId: first.id, queueToken: first.workerToken, pause: true, waitForStart: true });
    const competing = b.start("run", { jobId: second.id, queueToken: second.workerToken, waitForStart: true });
    const duplicate = c.start("run", { jobId: first.id, queueToken: first.workerToken, waitForStart: true });
    await Promise.all([a.event("ready-run", running.id), b.event("ready-run", competing.id), c.event("ready-run", duplicate.id)]);
    a.release(); b.release();
    expect(await competing.promise).toEqual({ status: "DEFERRED" });
    // Different jobs race at claim; the same-job duplicate is released while A is running.
    await a.event("batch", running.id);
    c.release(); expect(await duplicate.promise).toEqual({ status: "DEFERRED" });
    expect(await b.call("run", { jobId: second.id, queueToken: second.workerToken })).toEqual({ status: "DEFERRED" });
    expect(await b.call("candidate")).toBe(null);
    expect(await client.marketAggregationJob.count({ where: { status: "RUNNING" } })).toBe(1);
    // An interactive save must complete even while the builder is paused outside its transaction.
    await c.call("foreground", { ...session, index: 5 });
    const ai = await c.call("ai", { index: 1 }) as { id: string };
    expect((await c.call("ai", { index: 1 }) as { id: string }).id).toBe(ai.id);
    expect(await client.aiMessage.count({ where: { runId: ai.id } })).toBe(1);
    a.release();
    const capture = c.start("capture", session);
    const requested = await c.event("capture", capture.id);
    const claimed = await b.call("capture-claim", { taskId: requested.taskId }) as { lease: string };
    await b.call("capture-finish", { taskId: requested.taskId, lease: claimed.lease, heartbeat: true });
    const asset = await b.call("capture-finish", { taskId: requested.taskId, lease: claimed.lease }) as { id: string };
    expect(await b.call("capture-finish", { taskId: requested.taskId, lease: claimed.lease })).toEqual(asset);
    expect((await capture.promise as { id: string }).id).toBe(asset.id);
    expect(await client.aiAsset.count()).toBe(1);
    expect((await client.aiRun.findFirstOrThrow({ where: { conversationId: "capture-chat" } })).calls).toBe(0);
    const loaded: number[] = [];
    for (let index = 6; index < 21; index++) loaded.push(...await c.call("foreground", { ...session, index }) as number[]);
    expect(await running.promise).toEqual({ status: "COMPLETED" });
    expect((await client.marketAggregationJob.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("QUEUED");
    expect(await b.call("run", { jobId: second.id, queueToken: second.workerToken })).toEqual({ status: "COMPLETED" });
    const summaries = async (generationId: string | null) => (await client.marketAggregatedBar.findMany({ where: { generationId: generationId! }, orderBy: [{ scope: "asc" }, { intervalSeconds: "asc" }, { bucketStart: "asc" }] })).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "generationId")));
    const jobs = await client.marketAggregationJob.findMany({ orderBy: { datasetId: "asc" } });
    expect(await summaries(jobs[0].generationId)).toEqual(await summaries(jobs[1].generationId));
    expect(await client.marketBar.count()).toBe(count * 2);
    expect(await client.marketDrawing.count()).toBe(21);
    expect(await client.paperOrder.count({ where: { status: "CANCELLED" } })).toBe(20);
    expect(await client.paperFill.count()).toBe(0);
    expect((await client.paperTradingSession.findUniqueOrThrow({ where: { id: "account" } })).lastProcessedSequence).toBe(20);
    expect((await client.replayProgress.findFirstOrThrow({ where: { replaySessionId: session.sessionId } })).currentSequence).toBe(20);
    const percentile = (values: number[]) => [...values].sort((x, y) => x - y)[Math.ceil(values.length * 0.95) - 1];
    const metrics = { baselineP95: percentile(baseline), loadedP95: percentile(loaded), maximum: Math.max(...loaded) };
    console.info("aggregation-concurrency-latency", JSON.stringify(metrics));
    expect(metrics.loadedP95).toBeLessThanOrEqual(Math.max(metrics.baselineP95 * 2, 500));
    expect(metrics.maximum).toBeLessThanOrEqual(2000);
  }, 60000);
  it("atomically admits one of two simultaneous workers for the same queued identity", async () => {
    const job = await a.call("queue", { datasetId: "a" }) as { id: string; workerToken: string };
    const first = a.start("run", { jobId: job.id, queueToken: job.workerToken, pause: true, waitForStart: true });
    const second = b.start("run", { jobId: job.id, queueToken: job.workerToken, pause: true, waitForStart: true });
    await Promise.all([a.event("ready-run", first.id), b.event("ready-run", second.id)]);
    a.release(); b.release();
    const loser = await Promise.race([first.promise.then((result) => ({ peer: a, result })), second.promise.then((result) => ({ peer: b, result }))]);
    expect(loser.result).toEqual({ status: "DEFERRED" });
    const winner = loser.peer === a ? b : a;
    await winner.event("batch", loser.peer === a ? second.id : first.id);
    expect(await client.marketAggregationJob.count({ where: { status: "RUNNING" } })).toBe(1);
    winner.release();
    const results = await Promise.all([first.promise, second.promise]);
    expect(results).toContainEqual({ status: "COMPLETED" });
    expect(results).toContainEqual({ status: "DEFERRED" });
  }, 60000);
});
