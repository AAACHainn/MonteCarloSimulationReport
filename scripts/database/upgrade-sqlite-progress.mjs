import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";

// Native Node ESM maintenance CLI: keep its Chinese display and number formatting
// here; it does not import the browser's TypeScript i18n/format modules.
const phases = ["核对环境", "检查与备份", "建立基线", "副本升级", "重复演练", "写入前复核", "正式升级", "最终核对"];
const details = {
  environment: "核对环境及停写声明", "source-integrity": "源库完整性及外键检查", backup: "创建一致性数据库备份",
  "baseline-integrity": "检查备份完整性", baseline: "建立原字段数据基线", "files-backup": "备份配置、附件和导入文件",
  "rehearsal-copy": "创建升级演练副本", "rehearsal-original": "核对演练前后原字段数据", "source-recheck": "写入前复核正式库全量数据",
  "final-original": "最终核对正式库原字段数据", "final-integrity": "最终完整性、外键及日志模式核对", cleanup: "清理成功升级的演练副本",
};
for (const stage of ["rehearsal", "rehearsal-repeat", "apply"]) {
  details[stage + "-execute"] = "执行升级入口，等待子进程完成";
  details[stage + "-integrity"] = "核对目标结构、完整性和迁移历史";
  details[stage + "-fingerprint"] = "计算升级后全字段指纹";
}
const number = value => new Intl.NumberFormat("zh-CN").format(value);
const duration = value => {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export function createProgress(onProgress = () => {}, cancelFlag) {
  let state = { version: 1, sequence: 0, state: "RUNNING", phaseTotal: 8, startedAt: new Date().toISOString() }, warned = false;
  const checkCancellation = () => { if (cancelFlag && Atomics.load(cancelFlag, 0)) throw new Error("已请求取消；在安全边界停止，保留现场及维护锁"); };
  const emit = patch => {
    state = { ...state, ...patch, sequence: state.sequence + 1, lastWorkProgressAt: new Date().toISOString() };
    try { onProgress(state); } catch { if (!warned) { warned = true; console.error("警告：进度回调不可用，升级数据校验继续执行。"); } }
  };
  return {
    checkCancellation,
    step(phaseIndex, stepId, targetRole, detail = details[stepId], cancellable = true) {
      if (cancellable) checkCancellation();
      emit({ phaseIndex, phaseId: phases[phaseIndex - 1], stepId, targetRole, detail, stepStartedAt: new Date().toISOString(), tableName: null, tableIndex: null, tableTotal: null, completedRows: null, referenceRows: null, completedPages: null, totalPages: null, backupComplete: false, tableComplete: false });
      if (cancellable) checkCancellation();
    },
    update(patch) {
      checkCancellation();
      if (patch.cancellationOnly) return;
      if (patch.tableName) patch = { ...patch, tableComplete: false };
      emit(patch);
    },
    finish(state, extra) { emit({ state, ...extra }); },
  };
}

export function formatProgress(progress, now = Date.now(), heartbeat = false) {
  const pieces = [`[${progress.phaseIndex ?? 1}/${progress.phaseTotal ?? 8}] ${progress.phaseId ?? phases[0]}`, progress.detail];
  if (progress.tableName) {
    pieces.push(`${progress.tableName} · 表 ${progress.tableIndex}/${progress.tableTotal}`);
    if (progress.referenceRows == null) pieces.push(`已扫描 ${number(progress.completedRows)} 行（总行数未知）`);
    else {
      pieces.push(`${number(progress.completedRows)} / ${number(progress.referenceRows)} 行`);
      if (progress.completedRows > progress.referenceRows || (progress.tableComplete && progress.completedRows !== progress.referenceRows)) pieces.push("记录数变化，待核验");
      else if (progress.referenceRows > 0) pieces.push(`${(100 * progress.completedRows / progress.referenceRows).toFixed(1)}%`);
      else pieces.push("空表");
    }
  } else if (progress.backupComplete) pieces.push("备份完成");
  else if (progress.totalPages > 0 && progress.completedPages != null) pieces.push(`${(100 * progress.completedPages / progress.totalPages).toFixed(1)}%`);
  pieces.push(`本步骤 ${duration(now - Date.parse(progress.stepStartedAt ?? progress.startedAt))}`, `总耗时 ${duration(now - Date.parse(progress.startedAt))}`);
  if (heartbeat) pieces.push(`主进程存活；详细工作进度 ${duration(now - Date.parse(progress.lastWorkProgressAt))} 未更新`);
  return pieces.filter(Boolean).join(" · ");
}

export function createProgressDisplay({ output = process.stdout, heartbeatMs = 10000, persistMs = 5000, now = Date.now } = {}) {
  let latest, lastOutput = 0, lastPersist = 0, lastStep, warned = false, blocked = false, pending;
  const warn = () => { if (!warned) { warned = true; console.error("警告：部分进度显示或进度文件不可用，升级仍继续；请查看最终报告。"); } };
  const write = line => {
    if (blocked) { pending = line; return; }
    try { blocked = output.write(line + "\n") === false; } catch { warn(); }
  };
  const drain = () => { blocked = false; if (pending) { const line = pending; pending = null; write(line); } };
  output.on?.("drain", drain);
  output.on?.("error", warn);
  const persist = force => {
    if (!latest?.directory || (!force && now() - lastPersist < persistMs)) return;
    lastPersist = now();
    try {
      const file = join(latest.directory, "progress.json"), temporary = file + ".tmp";
      writeFileSync(temporary, JSON.stringify({ ...latest, heartbeatAt: new Date(now()).toISOString() }, null, 2) + "\n", { mode: 0o600 });
      renameSync(temporary, file);
    } catch { warn(); }
  };
  const print = heartbeat => {
    if (!latest) return;
    const line = `[${new Date(now()).toISOString()}] ${formatProgress(latest, now(), heartbeat)}`;
    write(line); lastOutput = now();
    if (latest.directory) { try { appendFileSync(join(latest.directory, "progress.log"), line + "\n", { mode: 0o600 }); } catch { warn(); } }
  };
  const timer = setInterval(() => { persist(false); if (latest && now() - lastOutput >= heartbeatMs) print(true); }, Math.min(1000, heartbeatMs));
  return {
    receive(progress) {
      latest = progress;
      const currentStep = `${progress.stepId}:${progress.tableName ?? ""}`;
      const changed = lastStep !== currentStep;
      if (changed || now() - lastOutput >= 1000) print(false);
      lastStep = currentStep;
      persist(changed || progress.state !== "RUNNING");
    },
    close() { clearInterval(timer); persist(true); output.off?.("drain", drain); output.off?.("error", warn); },
  };
}

export async function monitorUpgrade(options, { workerUrl = new URL("./upgrade-sqlite-worker.mjs", import.meta.url), displayOptions } = {}) {
  const shared = new SharedArrayBuffer(4), cancelFlag = new Int32Array(shared), display = createProgressDisplay(displayOptions);
  let result, failure;
  const cancel = () => { Atomics.store(cancelFlag, 0, 1); console.error("已请求取消，正在等待数据库/子进程到达安全边界；请勿强制关闭窗口。"); };
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try {
    const worker = new Worker(workerUrl, { workerData: { options, shared } });
    await new Promise((resolveWorker, reject) => {
      worker.on("message", message => {
        if (message.type === "progress") display.receive(message.progress);
        else if (message.type === "result") result = message.result;
        else if (message.type === "failure") { failure = new Error(message.message); failure.report = message.report; }
      });
      worker.on("error", error => { failure = error; });
      // A result message alone is not completion; wait for the worker to exit.
      worker.on("exit", code => {
        if (failure) reject(failure);
        else if (code !== 0 || !result) reject(new Error(`升级 Worker 异常退出 (${code})，保留数据库、备份及维护锁，请检查最后阶段`));
        else if (result.status !== "SUCCESS") reject(new Error(`升级 Worker 未返回成功结果（状态 ${result.status ?? "缺失"}），保留现场并检查报告`));
        else resolveWorker();
      });
    });
    return result;
  } finally { display.close(); process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}

/** Read filesystem metadata only. A living PID alone cannot prove task identity. */
export function readUpgradeStatus({ database, reportDirectory } = {}) {
  let lock = null;
  if (!reportDirectory) {
    const file = database + ".upgrade.lock";
    if (!existsSync(file)) return { state: "NO_ACTIVE_TASK", message: "没有活动维护锁；历史结果请使用 --report-dir <备份目录>。" };
    try { lock = JSON.parse(readFileSync(file, "utf8")); } catch { return { state: "UNKNOWN", message: "维护锁为旧版或内容不完整，无法确认任务状态；不会删除该锁。" }; }
    reportDirectory = lock.directory;
  }
  if (!reportDirectory) return { state: "UNKNOWN", message: "维护锁没有报告路径，无法确认任务状态。" };
  const directory = resolve(reportDirectory);
  const read = name => { try { return JSON.parse(readFileSync(join(directory, name), "utf8")); } catch { return null; } };
  const report = read("report.json"), progress = read("progress.json");
  let pidExists = false;
  if (lock?.pid) { try { process.kill(lock.pid, 0); pidExists = true; } catch (error) { pidExists = error.code === "EPERM"; } }
  const matches = lock?.runId && lock.runId === progress?.runId;
  const state = !report ? "REPORT_NOT_FOUND" : report.status !== "RUNNING" ? report.status : !lock ? "RUNNING_UNVERIFIED" : !pidExists ? "PROCESS_NOT_FOUND" : "IDENTITY_UNVERIFIED";
  if (!report) return { state, directory, report, progress: null, pidExists, message: "报告不存在或无法读取，无法确认升级结果；请核对目录路径，现场保持不变。" };
  return { state, directory, report, progress: !lock || matches ? progress : null, pidExists, message: state === "IDENTITY_UNVERIFIED" ? "该 PID 存在，但可能已复用；仅据时间戳判断最近是否有业务进度，不能证明任务仍在推进。" : !progress ? "没有新版进度文件，请参考报告阶段；锁和文件均保持不变。" : "状态仅供只读查看；主进程存活与业务进度推进是两回事。" };
}

export function printUpgradeStatus(status) {
  console.log(`升级状态：${status.state}\n${status.message}`);
  if (status.directory) console.log("报告目录：", status.directory);
  if (status.report) console.log("报告结果/阶段：", status.report.status, "/", status.report.phase, "；正式写入已开始：", Boolean(status.report.formalWriteStarted));
  if (status.progress) {
    console.log(formatProgress(status.progress));
    console.log("最近业务进度：", status.progress.lastWorkProgressAt, "；显示心跳：", status.progress.heartbeatAt);
  }
}
