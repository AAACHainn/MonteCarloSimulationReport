import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { replayStartSchema } from "@/lib/validations";
import { datasetSourceInterval } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { ReplaySessionError, getReplayScope, assertReplayWritable, markReplayMutation, runWithReplayScope } from "./scope";
import { projectionRecordId } from "./identity";
import { saveReplayCheckpoint } from "./checkpoint";

export const createReplaySessionSchema = replayStartSchema.extend({
  name: z.string().trim().min(1).max(100),
  mode: z.enum(["TRAINING", "LIVE_REPLAY"]),
});
export type CreateReplaySessionInput = z.infer<typeof createReplaySessionSchema>;

export async function createReplaySession(datasetId: string, input: CreateReplaySessionInput) {
  return prisma.$transaction(async (tx) => createSessionInTransaction(tx, datasetId, input));
}

export async function createSessionInTransaction(tx: Prisma.TransactionClient, datasetId: string, input: CreateReplaySessionInput) {
  const dataset = await tx.marketDataset.findUnique({ where: { id: datasetId } });
  if (!dataset || dataset.status !== "READY") throw new ReplaySessionError("DATASET_NOT_FOUND", 404, copy.marketReplay.datasetNotFound);
  const sourceSeconds = datasetSourceInterval(dataset);
  if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, input.displayIntervalSeconds)) {
    throw new ReplaySessionError("INVALID_INTERVAL", 400, copy.marketReplay.invalidDisplayInterval);
  }
  if (!resolveDisplaySession(dataset, input.displaySession)) {
    throw new ReplaySessionError("INVALID_DISPLAY_SESSION", 400, copy.marketReplay.unsupportedDisplaySession);
  }
  const first = await tx.marketBar.findFirst({
    where: { datasetId, timestamp: { gte: new Date(input.timestamp) } }, orderBy: { sequence: "asc" }, select: { sequence: true },
  });
  if (!first) throw new ReplaySessionError("INVALID_START", 400, copy.marketReplay.invalidStart);
  const session = await tx.replaySession.create({ data: { datasetId, name: input.name, mode: input.mode } });
  const projection = await tx.replayProjection.create({ data: {
    replaySessionId: session.id, generation: 1, status: "CURRENT", historyVersion: dataset.historyVersion,
    currentSequence: first.sequence - 1,
  } });
  await tx.replaySession.update({ where: { id: session.id }, data: { activeProjectionId: projection.id } });
  const progress = await tx.replayProgress.create({ data: {
    datasetId, replaySessionId: session.id, startSequence: first.sequence, currentSequence: first.sequence - 1,
    playbackRate: input.playbackRate, displayIntervalSeconds: input.displayIntervalSeconds, displaySession: input.displaySession,
  } });
  await tx.replayCheckpoint.create({ data: {
    projectionId: projection.id, sourceSequence: progress.currentSequence,
    state: JSON.stringify({ snapshot: null, account: null, stats: null }),
  } });
  return { ...session, activeProjectionId: projection.id, progress };
}

export async function archiveReplaySession(tx: Prisma.TransactionClient) {
  const scope = getReplayScope();
  if (!scope) throw new ReplaySessionError("SESSION_REQUIRED", 409, copy.replaySessions.required);
  await assertReplayWritable(tx, false);
  await tx.replaySession.update({ where: { id: scope.id }, data: { status: "ARCHIVED", version: { increment: 1 } } });
  await tx.replayJournalSession.updateMany({ where: { replaySessionId: scope.id }, data: { archivedAt: new Date() } });
}

export async function restartReplaySession(input?: CreateReplaySessionInput) {
  const scope = getReplayScope();
  if (!scope) throw new ReplaySessionError("SESSION_REQUIRED", 409, copy.replaySessions.required);
  return prisma.$transaction(async (tx) => {
    await assertReplayWritable(tx, false);
    const existing = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, include: { progress: true } });
    if (!existing.progress) throw new ReplaySessionError("SESSION_NOT_FOUND", 404, copy.replaySessions.missing);
    const start = await tx.marketBar.findUniqueOrThrow({
      where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: existing.progress.startSequence } },
    });
    const next = await createSessionInTransaction(tx, scope.datasetId, input ?? {
      name: existing.name, mode: scope.mode, timestamp: start.timestamp.toISOString(),
      playbackRate: existing.progress.playbackRate,
      displayIntervalSeconds: existing.progress.displayIntervalSeconds!,
      displaySession: existing.progress.displaySession as "ETH" | "RTH",
    });
    const account = await tx.paperTradingSession.findUnique({ where: { projectionId: scope.projectionId } });
    if (account) {
      const config = { initialCapital: account.initialCapital, currency: account.currency,
        commissionBps: account.commissionBps, slippageBps: account.slippageBps };
      const journal = await tx.replayJournalSession.create({ data: {
        datasetId: scope.datasetId, replaySessionId: next.id, name: next.name, replayGeneration: 1, ...config,
      } });
      await tx.paperTradingSession.create({ data: {
        id: projectionRecordId(next.activeProjectionId, `account_${next.id}`),
        datasetId: scope.datasetId, projectionId: next.activeProjectionId, journalSessionId: journal.id, ...config,
        lastProcessedSequence: next.progress.currentSequence, peakEquity: config.initialCapital,
        equitySampleStride: account.equitySampleStride,
      } });
      await runWithReplayScope({ id: next.id, datasetId: next.datasetId, projectionId: next.activeProjectionId,
        mode: next.mode as "TRAINING" | "LIVE_REPLAY", status: "ACTIVE", version: 1 },
      () => recordReplayCommand(tx, next.progress.currentSequence, "ACCOUNT_INIT", { ...config, logicalAccountId: `account_${next.id}`, equitySampleStride: account.equitySampleStride }));
    }
    await tx.replaySession.update({ where: { id: next.id }, data: { riskPreferences: existing.riskPreferences } });
    await archiveReplaySession(tx);
    return next;
  });
}

export async function recordReplayCommand(tx: Prisma.TransactionClient, sourceSequence: number, type: string, payload: unknown) {
  const scope = getReplayScope();
  if (!scope) return null;
  const latest = await tx.replayCommand.findFirst({
    where: { replaySessionId: scope.id, sourceSequence }, orderBy: { ordinal: "desc" }, select: { ordinal: true },
  });
  const command = await tx.replayCommand.create({ data: {
    replaySessionId: scope.id, sourceSequence, ordinal: (latest?.ordinal ?? 0) + 1, type, payload: JSON.stringify(payload),
  } });
  await tx.replayProjectionCommand.create({ data: { projectionId: scope.projectionId, commandId: command.id } });
  await saveReplayCheckpoint(tx, sourceSequence, command.ordinal, true);
  return command;
}

export async function updateSessionPreferences(id: string, expectedVersion: number, preferences: string) {
  const scope = getReplayScope();
  if (!scope || id !== scope.id) throw new ReplaySessionError("SESSION_NOT_FOUND", 404, copy.replaySessions.missing);
  await prisma.$transaction(async (tx) => {
    await assertReplayWritable(tx);
    if (expectedVersion !== scope.version) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    await tx.replaySession.update({ where: { id }, data: { riskPreferences: preferences } });
    await markReplayMutation(tx);
  });
}
