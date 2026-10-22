import { mkdirSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync, statSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldLoop } from "node:timers/promises";
import Database from "better-sqlite3";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { createDatabaseClient } from "../lib/sqlite-client.mjs";

// This probe creates NEW synthetic databases only. It never opens DATABASE_URL.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--samples")) throw new Error("Usage: diagnose-sqlite-commit.mjs [--samples 20..1000]");
const count = Number(args[1] ?? 160);
if (!Number.isInteger(count) || count < 20 || count > 1000) throw new Error("--samples must be 20..1000");
const root = resolve("tmp/sqlite-commit-diagnostics");
const dir = join(root, new Date().toISOString().replace(/[:.]/g, "-"));
const rel = relative(root, dir);
if (isAbsolute(rel) || rel.startsWith("..")) throw new Error("Invalid isolated probe directory");
mkdirSync(root, { recursive: true });
mkdirSync(dir); // Fail rather than reuse any existing probe directory.
const warmup = 8;
const round = n => Math.round(n * 1000) / 1000;
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = q => round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] ?? 0);
  return { p50: p(.5), p95: p(.95), p99: p(.99), max: p(1), over100: values.filter(n => n >= 100).length,
    over250: values.filter(n => n >= 250).length };
}
const payload = JSON.stringify({ cursor: 0, receipt: "synthetic".repeat(300) });
function prepare(file, sync, auto = 1000) {
  const db = new Database(file, { fileMustExist: false });
  if (db.prepare("SELECT sqlite_version() AS version").get().version !== "3.51.3") throw new Error("Unexpected SQLite version");
  db.pragma("journal_mode=WAL"); db.pragma("synchronous=" + sync); db.pragma("wal_autocheckpoint=" + auto);
  db.exec("BEGIN");
  for (let i = 0; i < 6; i++) {
    db.exec("CREATE TABLE ProbeState" + i + " (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL)");
    db.prepare("INSERT INTO ProbeState" + i + " VALUES (1, 0, ?)").run(payload);
  }
  db.exec("CREATE TABLE ProbeEquity (sequence INTEGER PRIMARY KEY, equity REAL NOT NULL)");
  db.exec("COMMIT"); db.pragma("wal_checkpoint(TRUNCATE)");
  return db;
}
function walBytes(file) { try { return statSync(file + "-wal").size; } catch { return 0; } }
async function rawProbe(name, sync, auto) {
  const file = join(dir, name + ".db");
  const db = prepare(file, sync, auto);
  const updates = Array.from({ length: 6 }, (_, i) => db.prepare("UPDATE ProbeState" + i + " SET version=?, body=? WHERE id=1"));
  const insert = db.prepare("INSERT INTO ProbeEquity VALUES (?, 100000)");
  const samples = [];
  try {
    for (let i = 0; i < count + warmup; i++) {
      await yieldLoop();
      const start = performance.now(); db.exec("BEGIN IMMEDIATE");
      for (const update of updates) update.run(i + 1, payload);
      insert.run(i);
      const beforeCommit = performance.now(); db.exec("COMMIT");
      const end = performance.now();
      if (i >= warmup) samples.push({ index: i - warmup, totalMs: round(end - start),
        commitMs: round(end - beforeCommit), walBytes: walBytes(file) });
    }
    if (db.prepare("SELECT COUNT(*) AS n FROM ProbeEquity").get().n !== count + warmup) throw new Error("Probe row count mismatch");
    const checkpointStart = performance.now();
    const checkpoint = db.pragma("wal_checkpoint(PASSIVE)");
    return { name, runtime: { version: "3.51.3", mode: "wal", synchronous: sync, autoCheckpointPages: auto },
      samples, totalMs: summary(samples.map(s => s.totalMs)), commitMs: summary(samples.map(s => s.commitMs)),
      explicitCheckpointMs: round(performance.now() - checkpointStart), checkpoint };
  } finally { db.close(); }
}

// Observe only transaction control calls in this diagnostic process; no SQL arguments are logged.
let transactionTrace = null;
const originalConnect = PrismaBetterSQLite3.prototype.connect;
function observe(adapter) {
  for (const name of ["queryRaw", "executeRaw", "executeScript", "commit", "rollback"]) {
    if (typeof adapter[name] !== "function") continue;
    const original = adapter[name].bind(adapter);
    adapter[name] = async (...values) => {
      const operation = String(values[0]?.sql ?? (name === "executeScript" ? values[0] : name)).trim().split(/\s+/)[0].toUpperCase();
      const trace = transactionTrace;
      if (!trace || !["COMMIT", "ROLLBACK", "BEGIN"].includes(operation)) return original(...values);
      const start = performance.now();
      const pending = original(...values);
      const syncReturned = performance.now();
      const result = await pending;
      trace.push({ method: name, operation, synchronousMs: round(syncReturned - start), totalMs: round(performance.now() - start) });
      return result;
    };
  }
  if (adapter.startTransaction) {
    const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (...values) => observe(await start(...values));
  }
  return adapter;
}
PrismaBetterSQLite3.prototype.connect = async function (...values) { return observe(await originalConnect.apply(this, values)); };
async function prismaProbe() {
  const name = "prisma-wal-full", file = join(dir, name + ".db");
  prepare(file, "FULL").close();
  const queries = [];
  const db = createDatabaseClient({ datasourceUrl: "file:" + file, log: [{ emit: "event", level: "query" }] },
    { env: { SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal" }, allowCreate: false });
  db.$on("query", event => { if (event.query.trim().toUpperCase().startsWith("COMMIT")) queries.push(event.duration); });
  const samples = [];
  try {
    await db.$connect();
    for (let i = 0; i < count + warmup; i++) {
      await yieldLoop(); transactionTrace = []; queries.length = 0;
      const start = performance.now(); let callbackEnded = start;
      await db.$transaction(async tx => {
        for (let table = 0; table < 6; table++) await tx.$executeRawUnsafe("UPDATE ProbeState" + table + " SET version=?, body=? WHERE id=1", i + 1, payload);
        await tx.$executeRawUnsafe("INSERT INTO ProbeEquity VALUES (?, 100000)", i);
        callbackEnded = performance.now();
      }, { timeout: 30000 });
      const end = performance.now();
      const commits = transactionTrace.filter(t => t.operation === "COMMIT" && t.method !== "commit");
      if (!commits.length) throw new Error("SQLite COMMIT was not captured by adapter instrumentation");
      if (i >= warmup) samples.push({ index: i - warmup, totalMs: round(end - start), commitEnvelopeMs: round(end - callbackEnded),
        sqliteCommitSyncMs: round(commits.reduce((sum, t) => sum + t.synchronousMs, 0)),
        adapterCommitMs: round(commits.reduce((sum, t) => sum + t.totalMs, 0)),
        prismaReportedCommitMs: queries.reduce((a, b) => a + b, 0), trace: transactionTrace, walBytes: walBytes(file) });
    }
    const [rows] = await db.$queryRawUnsafe("SELECT COUNT(*) AS n FROM ProbeEquity");
    if (Number(rows.n) !== count + warmup) throw new Error("Prisma probe row count mismatch");
    return { name, samples, totalMs: summary(samples.map(s => s.totalMs)),
      commitEnvelopeMs: summary(samples.map(s => s.commitEnvelopeMs)),
      sqliteCommitSyncMs: summary(samples.map(s => s.sqliteCommitSyncMs)),
      adapterCommitMs: summary(samples.map(s => s.adapterCommitMs)) };
  } finally { transactionTrace = null; await db.$disconnect(); }
}
async function flushProbe() {
  const file = join(dir, "flush-probe.bin"), fd = openSync(file, "wx");
  const block = Buffer.alloc(4096); const samples = [];
  try {
    for (let i = 0; i < Math.min(count, 100); i++) {
      await yieldLoop(); block.writeUInt32LE(i); writeSync(fd, block, 0, block.length, 0);
      const start = performance.now(); fsyncSync(fd); samples.push(round(performance.now() - start));
    }
    return { name: "file-fsync", syncMs: summary(samples), samples };
  } finally { closeSync(fd); }
}
const report = { createdAt: new Date().toISOString(), platform: process.platform, node: process.version,
  directory: dir, samplesPerDatabase: count, syntheticStateTables: 6, payloadBytes: Buffer.byteLength(payload), scenarios: [] };
const scenarios = [() => rawProbe("raw-wal-full", "FULL", 1000), prismaProbe,
  () => rawProbe("raw-wal-full-no-auto-checkpoint", "FULL", 0),
  () => rawProbe("raw-wal-normal-control", "NORMAL", 1000), flushProbe];
for (const scenario of scenarios) {
  const result = await scenario(); report.scenarios.push(result);
  const { samples, ...brief } = result;
  console.log(JSON.stringify({ event: "sqlite-commit-probe", ...brief, count: samples.length }));
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ event: "sqlite-commit-report", path: join(dir, "report.json") }));
