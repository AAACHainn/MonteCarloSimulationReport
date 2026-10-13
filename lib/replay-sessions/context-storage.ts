import type { Prisma } from "@prisma/client";
import { getReplayScope } from "./scope";
import type { ReplayContextRun } from "./context-runs";

export async function persistContextRuns(tx: Prisma.TransactionClient, runs: ReplayContextRun[]) {
  const scope = getReplayScope();
  if (!scope || !runs.length) return;
  let last = await tx.replayContextRun.findFirst({ where: { projectionId: scope.projectionId }, orderBy: { toSequence: "desc" } });
  for (const run of runs) {
    const context = JSON.stringify({ generation: run.generation, context: run.context });
    if (last?.toSequence === run.fromSequence - 1 && last.context === context) {
      last = await tx.replayContextRun.update({ where: { id: last.id }, data: { toSequence: run.toSequence } });
    } else last = await tx.replayContextRun.create({ data: {
      projectionId: scope.projectionId, fromSequence: run.fromSequence, toSequence: run.toSequence, context,
    } });
  }
}
