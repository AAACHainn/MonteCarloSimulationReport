import { prisma } from "../lib/db";
import { processImportJob } from "../lib/market-replay/import-jobs";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    process.exitCode = 1;
    return;
  }
  try {
    await processImportJob(jobId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
