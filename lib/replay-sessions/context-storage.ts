import type { Prisma } from "@prisma/client";
import { getReplayScope } from "./scope";
import type { ReplayContextRun } from "./context-runs";

export async function persistContextRuns(tx: Prisma.TransactionClient, runs: ReplayContextRun[]) {
  const scope = getReplayScope();
  if (!scope || !runs.length) return;
  const last = await tx.replayContextRun.findFirst({ where: { projectionId: scope.projectionId }, orderBy: { toSequence: "desc" } });
  const existingTail = last ? { ...last } : null;
  const additions: Prisma.ReplayContextRunCreateManyInput[] = [];
  let tail: { toSequence: number; context: string } | null = existingTail;
  for (const run of runs) {
    const context = JSON.stringify({ generation: run.generation, context: run.context,
      ...(run.flatAdvance ? { flatAdvance: run.flatAdvance } : {}) });
    if (tail?.toSequence === run.fromSequence - 1 && tail.context === context) {
      tail.toSequence = run.toSequence;
    } else {
      const next = { projectionId: scope.projectionId, fromSequence: run.fromSequence, toSequence: run.toSequence, context };
      additions.push(next);
      tail = next;
    }
  }
  if (last && existingTail && last.toSequence !== existingTail.toSequence) {
    await tx.replayContextRun.update({ where: { id: last.id }, data: { toSequence: existingTail.toSequence } });
  }
  for (let offset = 0; offset < additions.length; offset += 500) {
    await tx.replayContextRun.createMany({ data: additions.slice(offset, offset + 500) });
  }
}
