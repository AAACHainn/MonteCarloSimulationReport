import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createProgress, createProgressDisplay, formatProgress, monitorUpgrade, readUpgradeStatus } from "./upgrade-sqlite-progress.mjs";

const folder = () => mkdtempSync(join(tmpdir(), "db-progress-tests-"));
function output() {
  const stream = new EventEmitter(); stream.lines = [];
  stream.write = line => { stream.lines.push(line); return true; };
  return stream;
}
function event(extra = {}) {
  const now = new Date().toISOString();
  return { version: 1, runId: "synthetic-run", state: "RUNNING", stepId: "scan", phaseIndex: 3, phaseTotal: 8, phaseId: "建立基线", detail: "合成数据扫描", startedAt: now, stepStartedAt: now, lastWorkProgressAt: now, ...extra };
}
function worker(directory, source) { const file = join(directory, "fixture-worker.mjs"); writeFileSync(file, source); return pathToFileURL(file); }

describe("offline upgrade progress", () => {
  it("formats unknown and changing row counts and zero-page backups without invented percentages", () => {
    expect(formatProgress(event({ tableName: "MarketBar", tableIndex: 1, tableTotal: 2, completedRows: 100, referenceRows: null }))).toContain("总行数未知");
    expect(formatProgress(event({ tableName: "MarketBar", tableIndex: 1, tableTotal: 2, completedRows: 120, referenceRows: 100 }))).toContain("记录数变化");
    expect(formatProgress(event({ tableName: "MarketBar", tableIndex: 1, tableTotal: 2, completedRows: 80, referenceRows: 100, tableComplete: true }))).toContain("记录数变化");
    expect(formatProgress(event({ tableName: "Empty", completedRows: 0, referenceRows: 0 }))).toContain("空表");
    expect(formatProgress(event({ completedPages: 0, totalPages: 0 }))).not.toMatch(/NaN|Infinity|%/);
    expect(formatProgress(event({ completedPages: 99, totalPages: 100, backupComplete: true }))).toContain("备份完成");
    expect(formatProgress(event({ completedPages: 99, totalPages: 100, backupComplete: true }))).not.toContain("99.0%");
  });

  it("persists table transitions immediately and writes ordinary redirected lines with no secrets or terminal control codes", () => {
    const directory = folder(), stream = output(), display = createProgressDisplay({ output: stream });
    try {
      display.receive(event({ directory, tableName: "First", completedRows: 0 }));
      display.receive(event({ directory, tableName: "Second", completedRows: 0 }));
      expect(JSON.parse(readFileSync(join(directory, "progress.json"), "utf8")).tableName).toBe("Second");
      expect(stream.lines.join("")).toContain("Second");
      expect(stream.lines.join("")).not.toMatch(/\x1b|\r/);
      expect(readFileSync(join(directory, "progress.log"), "utf8")).not.toContain("DATABASE_URL");
    } finally { display.close(); }
  });

  it("coalesces stdout backpressure to a bounded latest message", () => {
    const stream = output(); stream.write = line => { stream.lines.push(line); return false; };
    const display = createProgressDisplay({ output: stream });
    try {
      for (let index = 0; index < 1000; index++) display.receive(event({ stepId: "step-" + index, detail: "step-" + index }));
      expect(stream.lines).toHaveLength(1);
      stream.emit("drain"); expect(stream.lines).toHaveLength(2);
      expect(stream.lines[1]).toContain("step-999");
    } finally { display.close(); }
  });

  it("degrades progress storage errors without throwing or changing cancellation checks", () => {
    const stream = output(), display = createProgressDisplay({ output: stream });
    try { expect(() => display.receive(event({ directory: join(folder(), "missing") }))).not.toThrow(); }
    finally { display.close(); }
    const flag = new Int32Array(new SharedArrayBuffer(4));
    const progress = createProgress(() => { throw new Error("display unavailable"); }, flag);
    expect(() => progress.step(1, "start", "source", "测试")).not.toThrow();
    Atomics.store(flag, 0, 1);
    expect(() => progress.update({ completedRows: 1 })).toThrow("取消");
  });

  it("keeps heartbeats responsive while the Worker is synchronously blocked and waits for Worker exit after result", async () => {
    const directory = folder(), stream = output();
    const workerUrl = worker(directory, `import { parentPort, workerData } from 'node:worker_threads';
      const now = new Date().toISOString();
      parentPort.postMessage({type:'progress',progress:{version:1,runId:'test',state:'RUNNING',stepId:'blocked',phaseIndex:2,phaseTotal:8,phaseId:'检查与备份',detail:'同步等待',directory:${JSON.stringify(directory)},startedAt:now,stepStartedAt:now,lastWorkProgressAt:now}});
      Atomics.wait(new Int32Array(workerData.shared),0,0,160);
      parentPort.postMessage({type:'result',result:{status:'SUCCESS'}});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);`);
    const start = Date.now();
    const result = await monitorUpgrade({}, { workerUrl, displayOptions: { output: stream, heartbeatMs: 30, persistMs: 20 } });
    expect(result.status).toBe("SUCCESS"); expect(Date.now() - start).toBeGreaterThanOrEqual(230);
    expect(stream.lines.join("")).toContain("主进程存活");
    expect(stream.lines.join("")).toContain("未更新");
    expect(existsSync(join(directory, "progress.json"))).toBe(true);
  });

  it("propagates Worker failures and safely cancels at a Worker boundary without terminating it", async () => {
    const directory = folder(), stream = output();
    const badWorker = worker(directory, "throw new Error('synthetic worker failure');");
    await expect(monitorUpgrade({}, { workerUrl: badWorker, displayOptions: { output: stream } })).rejects.toThrow("synthetic worker failure");
    const cancelWorker = worker(directory, `import { parentPort, workerData } from 'node:worker_threads';
      const flag = new Int32Array(workerData.shared);
      Atomics.wait(flag,0,0,180);
      parentPort.postMessage({type:'failure',message:Atomics.load(flag,0) ? 'cancelled at safe boundary' : 'not cancelled'});`);
    const pending = monitorUpgrade({}, { workerUrl: cancelWorker, displayOptions: { output: stream } });
    const timer = setTimeout(() => process.emit("SIGINT"), 40);
    try { await expect(pending).rejects.toThrow("cancelled at safe boundary"); }
    finally { clearTimeout(timer); }
  });

  it("disposes timers when Worker construction fails synchronously", async () => {
    vi.useFakeTimers();
    try {
      await expect(monitorUpgrade({}, { workerUrl: "invalid-worker-path", displayOptions: { output: output() } })).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("rejects a non-success result even when the Worker exits normally", async () => {
    const directory = folder();
    const workerUrl = worker(directory, "import { parentPort } from 'node:worker_threads'; parentPort.postMessage({type:'result',result:{status:'FAILED'}});");
    await expect(monitorUpgrade({}, { workerUrl, displayOptions: { output: output() } })).rejects.toThrow("未返回成功结果");
  });
});

describe("read-only upgrade status", () => {
  it("handles no active lock, legacy locks, absent progress, completed history and stale process without opening or creating a database", () => {
    const directory = folder(), database = join(directory, "never-created.db"), lock = database + ".upgrade.lock";
    expect(readUpgradeStatus({ database }).state).toBe("NO_ACTIVE_TASK");
    expect(readUpgradeStatus({ reportDirectory: directory }).state).toBe("REPORT_NOT_FOUND");
    expect(readUpgradeStatus({ reportDirectory: join(directory, "missing") }).state).toBe("REPORT_NOT_FOUND");
    writeFileSync(lock, "legacy lock");
    expect(readUpgradeStatus({ database }).state).toBe("UNKNOWN");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, directory, runId: "current-run" }));
    writeFileSync(join(directory, "report.json"), JSON.stringify({ status: "RUNNING", phase: "rehearsal" }));
    expect(readUpgradeStatus({ database })).toMatchObject({ state: "IDENTITY_UNVERIFIED", progress: null });
    writeFileSync(join(directory, "progress.json"), JSON.stringify(event({ runId: "other-run" })));
    expect(readUpgradeStatus({ database }).progress).toBe(null);
    expect(readUpgradeStatus({ reportDirectory: directory }).state).toBe("RUNNING_UNVERIFIED");
    writeFileSync(lock, JSON.stringify({ pid: 2147483647, directory }));
    expect(readUpgradeStatus({ database }).state).toBe("PROCESS_NOT_FOUND");
    writeFileSync(join(directory, "report.json"), JSON.stringify({ status: "SUCCESS", phase: "complete" }));
    expect(readUpgradeStatus({ reportDirectory: directory }).state).toBe("SUCCESS");
    expect(existsSync(database)).toBe(false); expect(existsSync(lock)).toBe(true);
  });
});
