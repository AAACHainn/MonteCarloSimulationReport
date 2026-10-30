import { executeRun } from "../../lib/ai/runs";
import { prisma } from "../../lib/db";
const id = process.argv[2];
if (!id) process.exitCode = 1;
else executeRun(id).catch(() => { process.exitCode = 1; }).finally(() => prisma.$disconnect());
