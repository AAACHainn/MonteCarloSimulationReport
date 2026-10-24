import type { Prisma } from "@prisma/client";

// A session keeps its current result and, only while correcting, one draft.
// Cascades remove the replaced account, fills, journal, contexts and checkpoints.
export async function pruneReplayResults(tx: Prisma.TransactionClient, replaySessionId: string) {
  const session = await tx.replaySession.findUniqueOrThrow({
    where: { id: replaySessionId }, select: { activeProjectionId: true, pendingCorrectionId: true },
  });
  const pending = session.pendingCorrectionId ? await tx.replayCorrectionJob.findFirst({
    where: { id: session.pendingCorrectionId, replaySessionId, status: { in: ["QUEUED", "RUNNING", "READY"] } },
    select: { targetProjectionId: true },
  }) : null;
  const rounds = await tx.propPracticeRound.findMany({ where: { replaySessionId }, select: { projectionId: true } });
  const kept = [session.activeProjectionId, pending?.targetProjectionId, ...rounds.map(round => round.projectionId)].filter((id): id is string => Boolean(id));
  await tx.replayProjection.deleteMany({ where: { replaySessionId, id: { notIn: kept } } });
  await tx.replayCommand.deleteMany({ where: { replaySessionId, projections: { none: {} } } });
  await tx.replayCorrectionJob.updateMany({
    where: { replaySessionId, targetProjectionId: { notIn: kept } }, data: { targetProjectionId: null },
  });
}
