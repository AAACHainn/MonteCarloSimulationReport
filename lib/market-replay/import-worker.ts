import { spawn } from "node:child_process";
import { join } from "node:path";

export const MARKET_IMPORT_WORKER_HEAP_MB = 1_024;

export function startMarketImportWorker(jobId: string) {
  const workerPath = join(process.cwd(), "scripts", "market-import-worker.ts");
  const child = spawn(process.execPath, [
    `--max-old-space-size=${MARKET_IMPORT_WORKER_HEAP_MB}`,
    "--import",
    "tsx",
    workerPath,
    jobId,
  ], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, MARKET_IMPORT_WORKER: "1" },
    stdio: "ignore",
    windowsHide: true,
  });
  if (!child.pid) throw new Error("Unable to start market import worker.");
  child.unref();
  return child.pid;
}
