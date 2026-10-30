import { prisma } from "@/lib/db";
import { runReplayCorrection } from "@/lib/replay-sessions/correction-runner";

const jobId = process.argv[2];
if (!jobId) throw new Error("A replay correction job id is required.");
async function main() {
  try { await runReplayCorrection(jobId); }
  finally { await prisma.$disconnect(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
