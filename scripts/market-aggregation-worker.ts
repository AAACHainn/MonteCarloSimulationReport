import { prisma } from "../lib/db";
import { processAggregationJob } from "../lib/market-replay/aggregation-jobs";

async function main() {
  try {
    if (!process.argv[2]) throw new Error("Missing job id");
    await processAggregationJob(process.argv[2]);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
void main();
