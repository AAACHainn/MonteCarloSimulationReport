import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { getReplayScope, runWithReplayScope, ReplaySessionError } from "@/lib/replay-sessions/scope";
import { recordReplayCommand } from "@/lib/replay-sessions/service";
import { projectionRecordId } from "@/lib/replay-sessions/identity";
import { funds, resetPropState, propRulesSchema, type PropState } from "./rules";
import type { PropSnapshot } from "./service";

import { chargePropPurchase } from "@/lib/user-wallet/service";

export async function listPropRounds() {
  const scope = getReplayScope()!;
  const [account, rounds] = await Promise.all([
    prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: scope.id } }),
    prisma.propPracticeRound.findMany({ where: { replaySessionId: scope.id }, orderBy: { number: "desc" }, include: { projection: { select: { _count: { select: { entries: true } } } } } }),
  ]);
  return rounds.map(round => {
    const state: PropState = JSON.parse(round.state), snapshot: PropSnapshot = JSON.parse(round.snapshot);
    return { number: round.number, current: round.number === account.roundNumber, phase: state.phase, result: state.result, pause: state.pause,
      ...funds(state), totalReceived: state.totalReceived, currency: snapshot.currency, startSequence: round.startSequence,
      endSequence: round.endSequence, entryCount: round.projection._count.entries, createdAt: round.createdAt.toISOString(), endedAt: round.endedAt?.toISOString() ?? null };
  });
}

export async function resetPropAccount(input: { expectedVersion: number; expectedProjectionId: string; requestId: string }) {
  const scope = getReplayScope()!;
  return sqliteWriteTransaction(prisma, async tx => {
    const prior = await tx.propPracticeRound.findUnique({ where: { replaySessionId_resetRequestId: { replaySessionId: scope.id, resetRequestId: input.requestId } } });
    if (prior) {
      const event = await tx.propPracticeEvent.findFirst({ where: { replaySessionId: scope.id, roundNumber: prior.number, type: "RESET" } });
      const evidence = event ? JSON.parse(event.evidence) : null;
      if (evidence?.expectedVersion !== input.expectedVersion || evidence?.expectedProjectionId !== input.expectedProjectionId) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
      return { number: prior.number, projectionId: prior.projectionId };
    }
    const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, include: { progress: true, dataset: { select: { historyVersion: true, barCount: true } } } });
    if (owner.version !== input.expectedVersion || owner.activeProjectionId !== input.expectedProjectionId
      || scope.projectionId !== owner.activeProjectionId) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    if (owner.pendingCorrectionId) throw new ReplaySessionError("CORRECTION_PENDING", 409, copy.replaySessions.busy);
    if (owner.accountCategory !== "PROP_PRACTICE" || owner.mode !== "TRAINING" || !owner.progress) throw new ReplaySessionError("PROP_RESET_INVALID", 409, copy.propPractice.resetUnavailable);
    const prop = await tx.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: scope.id } });
    const previous: PropState = JSON.parse(prop.state), snapshot: PropSnapshot = JSON.parse(prop.snapshot);
    const oldProjection = await tx.replayProjection.findUniqueOrThrow({ where: { id: scope.projectionId } });
    if (oldProjection.historyVersion !== owner.dataset.historyVersion) throw new ReplaySessionError("HISTORY_CHANGED", 409, copy.marketSync.historyChanged);
    if (owner.progress.currentSequence >= owner.dataset.barCount - 1) throw new ReplaySessionError("PROP_RESET_INVALID", 409, copy.paperTrading.noNextBar);
    let state: PropState;
    try { state = resetPropState(propRulesSchema.parse(snapshot.rules), previous, owner.progress.currentSequence + 1); }
    catch { throw new ReplaySessionError("PROP_RESET_INVALID", 409, copy.propPractice.resetUnavailable); }
    const oldAccount = await tx.paperTradingSession.findUniqueOrThrow({ where: { projectionId: scope.projectionId } });
    // Keep the entire old execution result, including the automatic failure close and cancelled orders.
    await tx.propPracticeRound.update({ where: { replaySessionId_number: { replaySessionId: scope.id, number: prop.roundNumber } },
      data: { state: prop.state, trainingGate: owner.trainingGate, endSequence: owner.progress.currentSequence, endedAt: new Date() } });
    await tx.replayProjection.update({ where: { id: scope.projectionId }, data: { status: `ROUND_${prop.roundNumber}` } });
    const projection = await tx.replayProjection.create({ data: { replaySessionId: scope.id, status: "CURRENT", historyVersion: oldProjection.historyVersion, currentSequence: owner.progress.currentSequence } });
    const number = prop.roundNumber + 1;
    await chargePropPurchase(tx, owner, number, snapshot.rules);
    const config = { initialCapital: snapshot.rules.evaluation.risk.initialCapital, currency: oldAccount.currency,
      commissionBps: oldAccount.commissionBps, slippageBps: oldAccount.slippageBps };
    await tx.paperTradingSession.create({ data: { id: projectionRecordId(projection.id, `account_${scope.id}`), projectionId: projection.id,
      datasetId: scope.datasetId, journalSessionId: oldAccount.journalSessionId, ...config, lastProcessedSequence: owner.progress.currentSequence,
      peakEquity: config.initialCapital, equitySampleStride: oldAccount.equitySampleStride } });
    await tx.propPracticeAccount.update({ where: { replaySessionId: scope.id }, data: { roundNumber: number, state: JSON.stringify(state) } });
    await tx.propPracticeRound.create({ data: { replaySessionId: scope.id, number, projectionId: projection.id,
      snapshot: prop.snapshot, state: JSON.stringify(state), trainingGate: owner.trainingGate, startSequence: owner.progress.currentSequence + 1, resetRequestId: input.requestId } });
    await tx.replaySession.update({ where: { id: scope.id }, data: { activeProjectionId: projection.id, status: "ACTIVE", version: { increment: 1 } } });
    await tx.replayProgress.update({ where: { replaySessionId: scope.id }, data: { generation: { increment: 1 }, syncVersion: { increment: 1 }, lastSyncRequestId: null, lastSyncResponse: null } });
    await tx.replayJournalSession.updateMany({ where: { replaySessionId: scope.id }, data: { archivedAt: null } });
    await tx.propPracticeEvent.create({ data: { replaySessionId: scope.id, roundNumber: number, type: "RESET", evidence: JSON.stringify({ previousRound: prop.roundNumber, number, sequence: owner.progress.currentSequence, ...input }) } });
    await runWithReplayScope({ ...scope, status: "ACTIVE", projectionId: projection.id }, async () => {
      await recordReplayCommand(tx, owner.progress!.currentSequence, "ACCOUNT_INIT", { ...config, logicalAccountId: `account_${scope.id}`, propSnapshot: snapshot, equitySampleStride: oldAccount.equitySampleStride });
      await recordReplayCommand(tx, owner.progress!.currentSequence, "PROP_RESET", { previousRound: prop.roundNumber, number, requestId: input.requestId });
    });
    return { number, projectionId: projection.id };
  });
}
