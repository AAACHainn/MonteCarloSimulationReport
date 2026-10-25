import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { parseTrainingGate, restartTrainingGate } from "@/lib/paper-trading/training-gate";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { replayStartSchema, paperSessionSchema } from "@/lib/validations";
import { initialPropState, propRulesSchema, type PropState } from "@/lib/prop-practice/rules";
import { propTradingDay } from "@/lib/prop-practice/trading-day";
import { datasetSession, datasetSourceInterval } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { ReplaySessionError, getReplayScope, assertReplayWritable, assertSessionMetadataWritable, markReplayMutation, runWithReplayScope } from "./scope";
import { projectionRecordId } from "./identity";
import { saveReplayCheckpoint } from "./checkpoint";
import { assertUserExists, inheritSessionOwnership, newSessionOwnership, type SessionOwnershipData } from "@/lib/user-growth/ownership";

export const createReplaySessionSchema = replayStartSchema.extend({
  name: z.string().trim().min(1).max(100),
  mode: z.enum(["TRAINING", "LIVE_REPLAY"]),
  accountCategory: z.enum(["STANDARD", "PROP_PRACTICE"]).optional(),
  propTemplateVersionId: z.string().min(1).optional(),
  propAccountConfig: paperSessionSchema.omit({ initialCapital: true }).optional(),
  userId: z.string().min(1).max(128).nullable().optional(),
});
export type CreateReplaySessionInput = z.infer<typeof createReplaySessionSchema>;

export const deleteReplaySessionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

export async function createReplaySession(datasetId: string, input: CreateReplaySessionInput) {
  return sqliteWriteTransaction(prisma, async (tx) => createSessionInTransaction(tx, datasetId, input));
}

export async function createSessionInTransaction(tx: Prisma.TransactionClient, datasetId: string, input: CreateReplaySessionInput, restarting = false, inheritedOwnership?: SessionOwnershipData) {
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
    where: { datasetId, timestamp: { gte: new Date(input.timestamp) } }, orderBy: { sequence: "asc" }, select: { sequence: true, timestamp: true },
  });
  if (!first) throw new ReplaySessionError("INVALID_START", 400, copy.marketReplay.invalidStart);
  const isProp = input.accountCategory === "PROP_PRACTICE";
  const ownership = inheritedOwnership ?? newSessionOwnership(input.userId, input.mode);
  await assertUserExists(tx, ownership.userId);
  const session = await tx.replaySession.create({ data: { datasetId, name: input.name, mode: input.mode, accountCategory: isProp ? "PROP_PRACTICE" : "STANDARD", ...ownership } });
  const projection = await tx.replayProjection.create({ data: {
    replaySessionId: session.id, status: "CURRENT", historyVersion: dataset.historyVersion,
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
  if (isProp) {
    await runWithReplayScope({ id: session.id, datasetId, projectionId: projection.id, mode: session.mode as "TRAINING" | "LIVE_REPLAY", status: "ACTIVE", version: 1, accountCategory: session.accountCategory },
      () => initializePropPracticeAccount(tx, input.propTemplateVersionId, input.propAccountConfig, restarting));
  }
  return { ...session, activeProjectionId: projection.id, progress };
}

/** Account binding and ledger initialization share the account-create transaction.
 * Also used internally when restarting an existing prop session. */
export async function initializePropPracticeAccount(
  tx: Prisma.TransactionClient, templateVersionId: string | undefined,
  accountConfig: Omit<z.infer<typeof paperSessionSchema>, "initialCapital"> | undefined, restarting = false,
) {
  const scope = getReplayScope();
  if (!scope || scope.mode !== "TRAINING") throw new ReplaySessionError("INVALID_PROP", 400, copy.propPractice.trainingOnly);
  const [template, dataset, progress, owner, account, existingProp] = await Promise.all([
    templateVersionId ? tx.propPracticeTemplateVersion.findUnique({ where: { id: templateVersionId }, include: { template: true } }) : null,
    tx.marketDataset.findUniqueOrThrow({ where: { id: scope.datasetId } }),
    tx.replayProgress.findUniqueOrThrow({ where: { replaySessionId: scope.id } }),
    tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } }),
    tx.paperTradingSession.findUnique({ where: { projectionId: scope.projectionId } }),
    tx.propPracticeAccount.findUnique({ where: { replaySessionId: scope.id } }),
  ]);
  if (account || existingProp) throw new ReplaySessionError("ACCOUNT_EXISTS", 409, copy.propPractice.accountFixed);
  if (!template) throw new ReplaySessionError("TEMPLATE_CONFLICT", 409, copy.propPractice.templateConflict);
  if ((!template.template.active && !restarting) || !accountConfig) throw new ReplaySessionError("INVALID_PROP", 400, copy.propPractice.invalidRules);
  let storedRules: unknown;
  try { storedRules = JSON.parse(template.rules); } catch { throw new ReplaySessionError("INVALID_PROP", 400, copy.propPractice.invalidRules); }
  const parsedRules = propRulesSchema.safeParse(storedRules);
  if (!parsedRules.success) throw new ReplaySessionError("INVALID_PROP", 400, copy.propPractice.invalidRules);
  const rules = parsedRules.data;
  const sourceSeconds = datasetSourceInterval(dataset);
  if (!sourceSeconds) throw new ReplaySessionError("PROP_CALENDAR", 400, copy.propPractice.calendarInvalid);
  const calendar = { session: datasetSession(dataset), sourceSeconds };
  const bar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: Math.max(progress.startSequence, progress.currentSequence) } } });
  if (!bar || !propTradingDay(bar.timestamp, calendar)) throw new ReplaySessionError("PROP_CALENDAR", 400, copy.propPractice.calendarInvalid);
  const config = paperSessionSchema.parse({ ...accountConfig, initialCapital: rules.evaluation.risk.initialCapital });
  const snapshot = { rules, calendar, currency: config.currency, accountConfig: config };
  await tx.replaySession.update({ where: { id: scope.id }, data: { accountCategory: "PROP_PRACTICE" } });
  await tx.propPracticeAccount.create({ data: { replaySessionId: scope.id, templateVersionId: template.id,
    snapshot: JSON.stringify(snapshot), state: JSON.stringify(initialPropState(rules, progress.currentSequence + 1)) } });
  await tx.propPracticeRound.create({ data: { replaySessionId: scope.id, number: 1, projectionId: scope.projectionId,
    snapshot: JSON.stringify(snapshot), state: JSON.stringify(initialPropState(rules, progress.currentSequence + 1)),
    trainingGate: owner.trainingGate, startSequence: progress.currentSequence + 1 } });
  const journal = await tx.replayJournalSession.create({ data: { datasetId: scope.datasetId, replaySessionId: scope.id, name: owner.name, replayGeneration: progress.generation, ...config } });
  const equitySampleStride = Math.max(1, Math.ceil(dataset.barCount / 20000));
  await tx.paperTradingSession.create({ data: { id: projectionRecordId(scope.projectionId, `account_${scope.id}`),
    datasetId: scope.datasetId, projectionId: scope.projectionId, journalSessionId: journal.id, ...config,
    lastProcessedSequence: progress.currentSequence, peakEquity: config.initialCapital, equitySampleStride } });
  await runWithReplayScope({ ...scope, accountCategory: "PROP_PRACTICE" },
    () => recordReplayCommand(tx, progress.currentSequence, "ACCOUNT_INIT", { ...config, logicalAccountId: `account_${scope.id}`, propSnapshot: snapshot, equitySampleStride }));
}

export async function archiveReplaySession(tx: Prisma.TransactionClient) {
  const scope = getReplayScope();
  if (!scope) throw new ReplaySessionError("SESSION_REQUIRED", 409, copy.replaySessions.required);
  await assertReplayWritable(tx, false);
  if (scope.accountCategory === "PROP_PRACTICE") {
    const row = await tx.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: scope.id } });
    const state: PropState = JSON.parse(row.state);
    if (!state.result) {
      state.result = "STOPPED";
      state.stages[state.stages.length - 1].endSequence = state.last?.sequence ?? null;
      await tx.propPracticeAccount.update({ where: { replaySessionId: scope.id }, data: { state: JSON.stringify(state) } });
      const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
      await tx.propPracticeRound.updateMany({ where: { projectionId: scope.projectionId }, data: { state: JSON.stringify(state), trainingGate: owner.trainingGate, endSequence: state.last?.sequence, endedAt: new Date() } });
      await tx.propPracticeEvent.create({ data: { replaySessionId: scope.id, roundNumber: row.roundNumber, type: "STOPPED", evidence: JSON.stringify(state) } });
    }
  }
  await tx.replaySession.update({ where: { id: scope.id }, data: { status: "ARCHIVED", version: { increment: 1 } } });
  await tx.replayJournalSession.updateMany({ where: { replaySessionId: scope.id }, data: { archivedAt: new Date() } });
}

export async function renameReplaySession(tx: Prisma.TransactionClient, name: string) {
  const scope = await assertSessionMetadataWritable(tx);
  await tx.replaySession.update({ where: { id: scope.id }, data: { name } });
  await tx.replayJournalSession.updateMany({ where: { replaySessionId: scope.id }, data: { name } });
  await markReplayMutation(tx);
}

export async function deleteReplaySession(tx: Prisma.TransactionClient, expectedVersion: number) {
  const scope = await assertSessionMetadataWritable(tx);
  if (scope.version !== expectedVersion) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
  // Session-owned records cascade; shared market data and other sessions remain intact.
  await tx.replaySession.delete({ where: { id: scope.id } });
}

export async function restartReplaySession(input?: CreateReplaySessionInput) {
  const scope = getReplayScope();
  if (!scope) throw new ReplaySessionError("SESSION_REQUIRED", 409, copy.replaySessions.required);
  return sqliteWriteTransaction(prisma, async (tx) => {
    await assertReplayWritable(tx, false);
    const existing = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, include: { progress: true } });
    if (!existing.progress) throw new ReplaySessionError("SESSION_NOT_FOUND", 404, copy.replaySessions.missing);
    const start = await tx.marketBar.findUniqueOrThrow({
      where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: existing.progress.startSequence } },
    });
    const previousAccount = await tx.paperTradingSession.findUnique({ where: { projectionId: scope.projectionId } });
    const previousProp = existing.accountCategory === "PROP_PRACTICE" ? await tx.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: scope.id } }) : null;
    const nextInput = input ?? {
      name: existing.name, mode: scope.mode, timestamp: start.timestamp.toISOString(),
      playbackRate: existing.progress.playbackRate,
      displayIntervalSeconds: existing.progress.displayIntervalSeconds!,
      displaySession: existing.progress.displaySession as "ETH" | "RTH",
    };
    const next = await createSessionInTransaction(tx, scope.datasetId, { ...nextInput,
      ...(previousProp && previousAccount ? { mode: "TRAINING" as const, accountCategory: "PROP_PRACTICE" as const, propTemplateVersionId: previousProp.templateVersionId,
        propAccountConfig: { currency: previousAccount.currency, commissionBps: previousAccount.commissionBps, slippageBps: previousAccount.slippageBps } } : {}),
    }, true, inheritSessionOwnership(existing, existing.mode === "LIVE_REPLAY" || nextInput.mode === "LIVE_REPLAY" ? "LIVE_REPLAY" : "TRAINING"));
    const account = await tx.paperTradingSession.findUnique({ where: { projectionId: scope.projectionId } });
    if (account && next.accountCategory !== "PROP_PRACTICE") {
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
    await tx.replaySession.update({ where: { id: next.id }, data: { riskPreferences: existing.riskPreferences, trainingGate: JSON.stringify(restartTrainingGate(parseTrainingGate(existing.trainingGate))) } });
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
  await sqliteWriteTransaction(prisma, async (tx) => {
    await assertReplayWritable(tx);
    if (expectedVersion !== scope.version) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    await tx.replaySession.update({ where: { id }, data: { riskPreferences: preferences } });
    await markReplayMutation(tx);
  });
}
