import { spawn } from "node:child_process";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { endCorrection } from "./corrections";
import { copy } from "@/lib/i18n";

export async function startReplayCorrectionWorker(jobId: string) {
  const databases = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  const databaseUrl = `file:${databases[0].file}`;
  const child = spawn(process.execPath, ["--max-old-space-size=512", "--import", "tsx", join(process.cwd(), "scripts/replay-correction-worker.ts"), jobId], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, detached: true, stdio: "ignore", windowsHide: true,
  });
  const pid = child.pid;
  child.once("error", () => { void endCorrection(jobId, "FAILED", copy.replaySessions.correctionInterrupted); });
  if (!pid) {
    await endCorrection(jobId, "FAILED", copy.replaySessions.correctionInterrupted);
    throw new Error(copy.replaySessions.correctionInterrupted);
  }
  child.unref();
  await prisma.replayCorrectionJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { workerPid: pid, heartbeatAt: new Date() } });
  return pid;
}
