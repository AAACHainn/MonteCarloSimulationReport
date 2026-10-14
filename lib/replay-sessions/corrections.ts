import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { ReplaySessionError, loadReplayScope, runWithReplayScope, assertReplayWritable } from "./scope";
import { pruneReplayResults } from "./prune-results";

export const correctionSchema = z.object({
  requestId: z.string().min(1).max(120), expectedVersion: z.number().int().positive(),
  type: z.enum(["REWIND", "DELETE_CYCLE"]), targetSequence: z.number().int().min(-1).optional(),
  cycleKey: z.string().min(1).max(2048).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.type === "REWIND" ? value.targetSequence === undefined || value.cycleKey !== undefined : !value.cycleKey || value.targetSequence !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: copy.replaySessions.correctionInvalid });
  }
});
export type CorrectionInput = z.infer<typeof correctionSchema>;
export async function createCorrection(sessionId: string, input: CorrectionInput) {
  const scope = await loadReplayScope(sessionId);
  return runWithReplayScope(scope, () => prisma.$transaction(async (tx) => {
    if (scope.mode !== "LIVE_REPLAY") throw new ReplaySessionError("MODE_NOT_ALLOWED", 403, copy.replaySessions.modeBlocked);
    const previous = await tx.replayCorrectionJob.findUnique({ where: { replaySessionId_requestId: { replaySessionId: sessionId, requestId: input.requestId } } });
    if (previous) {
      if (previous.type !== input.type || (input.type === "REWIND" ? previous.targetSequence !== input.targetSequence : previous.cycleKey !== input.cycleKey)) {
        throw new ReplaySessionError("REQUEST_CONFLICT", 409, copy.replaySessions.conflict);
      }
      return previous;
    }
    await assertReplayWritable(tx);
    if (scope.version !== input.expectedVersion) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    const session = await tx.replaySession.findUniqueOrThrow({ where: { id: sessionId }, include: { progress: true, activeProjection: { include: { account: true } } } });
    if (session.legacy || !session.progress || !session.activeProjection) throw new ReplaySessionError("HISTORY_MISSING", 409, copy.replaySessions.correctionHistoryMissing);
    const dataset = await tx.marketDataset.findUniqueOrThrow({ where: { id: scope.datasetId } });
    if (dataset.historyVersion !== session.activeProjection.historyVersion) throw new ReplaySessionError("HISTORY_CHANGED", 409, copy.marketSync.historyChanged);
    const targetSequence = input.type === "REWIND" ? input.targetSequence! : session.progress.currentSequence;
    if (targetSequence < session.progress.startSequence - 1 || targetSequence > session.progress.currentSequence) {
      throw new ReplaySessionError("INVALID_TARGET", 400, copy.replaySessions.correctionInvalid);
    }
    let fallbackTargetSequence: number | undefined;
    if (input.type === "DELETE_CYCLE") {
      const account = session.activeProjection.account;
      const closed = account ? await tx.paperFill.findFirst({ where: { sessionId: account.id, cycleKey: input.cycleKey, netQuantityAfter: 0 } }) : null;
      if (!closed) throw new ReplaySessionError("CYCLE_NOT_CLOSED", 400, copy.replaySessions.correctionInvalid);
      const bounds = await tx.paperOrder.aggregate({ where: { sessionId: account!.id, isProtective: false, fills: { some: { cycleKey: input.cycleKey } } }, _min: { createdSequence: true } });
      fallbackTargetSequence = bounds._min.createdSequence ?? undefined;
      if (fallbackTargetSequence === undefined) throw new ReplaySessionError("HISTORY_MISSING", 409, copy.replaySessions.correctionHistoryMissing);
    }
    const job = await tx.replayCorrectionJob.create({ data: {
      requestId: input.requestId, replaySessionId: sessionId, type: input.type, baseProjectionId: scope.projectionId,
      targetSequence, cycleKey: input.cycleKey, expectedVersion: scope.version, historyVersion: dataset.historyVersion,
      summary: JSON.stringify({ fallbackTargetSequence }),
    } });
    await tx.replaySession.update({ where: { id: sessionId }, data: { pendingCorrectionId: job.id } });
    return job;
  }));
}

export async function endCorrection(jobId: string, status: "FAILED" | "INTERRUPTED" | "CANCELLED", error?: string) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.replayCorrectionJob.findUnique({ where: { id: jobId } });
    if (!job || ["APPLIED", "CANCELLED", "FAILED", "INTERRUPTED"].includes(job.status)) return job;
    await tx.replayCorrectionJob.update({ where: { id: jobId }, data: { status, error } });
    await tx.replaySession.updateMany({ where: { id: job.replaySessionId, pendingCorrectionId: jobId }, data: { pendingCorrectionId: null, version: { increment: 1 } } });
    await pruneReplayResults(tx, job.replaySessionId);
    return tx.replayCorrectionJob.findUniqueOrThrow({ where: { id: jobId } });
  }, { timeout: 120_000 });
}

export async function readCorrection(sessionId: string, jobId: string) {
  let job = await prisma.replayCorrectionJob.findFirst({ where: { id: jobId, replaySessionId: sessionId } });
  if (!job) throw new ReplaySessionError("JOB_NOT_FOUND", 404, copy.replaySessions.missing);
  if (["QUEUED", "RUNNING"].includes(job.status) && Date.now() - (job.heartbeatAt ?? job.createdAt).getTime() > 30_000) {
    let running = Boolean(job.workerPid);
    if (job.workerPid) try { process.kill(job.workerPid, 0); } catch (error) { running = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
    if (!running) { await endCorrection(jobId, "INTERRUPTED", copy.replaySessions.correctionInterrupted); job = await prisma.replayCorrectionJob.findUniqueOrThrow({ where: { id: jobId } }); }
  }
  return { ...job, summary: JSON.parse(job.summary), createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), heartbeatAt: job.heartbeatAt?.toISOString() ?? null };
}

export async function commitCorrection(sessionId: string, jobId: string) {
  return prisma.$transaction(async (tx) => {
    const [session, job] = await Promise.all([
      tx.replaySession.findUnique({ where: { id: sessionId }, include: { progress: true, dataset: { select: { historyVersion: true } } } }),
      tx.replayCorrectionJob.findFirst({ where: { id: jobId, replaySessionId: sessionId } }),
    ]);
    if (!session || !job) throw new ReplaySessionError("JOB_NOT_FOUND", 404, copy.replaySessions.missing);
    if (job.status === "APPLIED") return { ok: true, projectionId: session.activeProjectionId };
    if (session.mode !== "LIVE_REPLAY") throw new ReplaySessionError("MODE_NOT_ALLOWED", 403, copy.replaySessions.modeBlocked);
    if (job.status !== "READY" || !job.targetProjectionId || session.pendingCorrectionId !== job.id || session.activeProjectionId !== job.baseProjectionId || session.version !== job.expectedVersion || !session.progress) {
      throw new ReplaySessionError("CORRECTION_NOT_READY", 409, copy.replaySessions.correctionNotReady);
    }
    if (session.dataset.historyVersion !== job.historyVersion) throw new ReplaySessionError("HISTORY_CHANGED", 409, copy.marketSync.historyChanged);
    const projection = await tx.replayProjection.findUniqueOrThrow({ where: { id: job.targetProjectionId } });
    if (projection.currentSequence !== job.targetSequence) throw new ReplaySessionError("CORRECTION_NOT_READY", 409, copy.replaySessions.correctionNotReady);
    // Annotations may be edited during preview. Refresh surviving logical entries
    // from the visible version immediately before changing the head.
    let cursor: string | undefined;
    while (true) {
      const entries = await tx.replayJournalEntry.findMany({ where: { projectionId: job.targetProjectionId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!entries.length) break;
      const originals = await tx.replayJournalEntry.findMany({ where: { projectionId: job.baseProjectionId, logicalKey: { in: entries.flatMap((entry) => entry.logicalKey ? [entry.logicalKey] : []) } }, include: { tradeReasons: { select: { id: true } } } });
      const byKey = new Map(originals.map((entry) => [entry.logicalKey, entry]));
      for (const entry of entries) {
        const original = byKey.get(entry.logicalKey);
        if (original) await tx.replayJournalEntry.update({ where: { id: entry.id }, data: { review: original.review, setupOptionId: original.setupOptionId, tradeReasons: { set: original.tradeReasons.map(({ id }) => ({ id })) } } });
      }
      cursor = entries.at(-1)!.id;
    }
    await tx.replaySession.update({ where: { id: sessionId }, data: { activeProjectionId: job.targetProjectionId, pendingCorrectionId: null, version: { increment: 1 } } });
    await pruneReplayResults(tx, sessionId);
    await tx.replayProjection.update({ where: { id: job.targetProjectionId }, data: { status: "CURRENT" } });
    await tx.replayProgress.update({ where: { id: session.progress.id }, data: { currentSequence: job.targetSequence, generation: { increment: 1 }, syncVersion: 0, lastSyncRequestId: null, lastSyncResponse: null } });
    await tx.replayCorrectionJob.update({ where: { id: jobId }, data: { status: "APPLIED" } });
    return { ok: true, projectionId: job.targetProjectionId };
  }, { timeout: 120_000 });
}

export async function cancelCorrection(sessionId: string, jobId: string) {
  await readCorrection(sessionId, jobId);
  return endCorrection(jobId, "CANCELLED", copy.replaySessions.correctionCanceled);
}
