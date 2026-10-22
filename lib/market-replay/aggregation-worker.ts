import { spawn } from "node:child_process";
import { join } from "node:path";

export function startAggregationWorker(jobId: string, queueToken: string | null) {
  const child = spawn(process.execPath, ["--max-old-space-size=1024", "--import", "tsx", join(process.cwd(), "scripts", "market-aggregation-worker.ts"), jobId, queueToken ?? ""], {
    cwd: process.cwd(), detached: true, env: { ...process.env }, stdio: "ignore", windowsHide: true,
  });
  if (!child.pid) throw new Error("Unable to start aggregation worker");
  child.unref();
  return child;
}
