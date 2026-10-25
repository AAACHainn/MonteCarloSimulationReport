import { settleGrowth } from "@/lib/user-growth/settlement";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { getReplayScope, assertReplayWritable, markReplayMutation, ReplaySessionError, accountWhere, progressWhere } from "@/lib/replay-sessions/scope";
import { recordReplayCommand } from "@/lib/replay-sessions/service";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { applyPayout, payoutPreview, promotePropManually, promotionPreview, propRulesSchema, propTradingBlockReason, observeProp, settlePropDay, type PropState, type PropRules } from "./rules";
import { propTradingDay, type PropCalendar } from "./trading-day";
import { hydrateStageMetrics } from "./stage-metrics-read";

export type PropSnapshot = { rules: PropRules; calendar: PropCalendar; currency: string; accountConfig: import("@/lib/paper-trading/types").PaperAccountConfig };
export type PropRuntime = { snapshot: PropSnapshot; state: PropState; roundNumber?: number };
export async function loadPropAccount(tx: Prisma.TransactionClient = prisma): Promise<PropRuntime | null> {
  const scope = getReplayScope();
  if (!scope || scope.accountCategory !== "PROP_PRACTICE") return null;
  if (scope.propRoundNumber && scope.propRoundNumber > 0) {
    const round = await tx.propPracticeRound.findUniqueOrThrow({ where: { replaySessionId_number: { replaySessionId: scope.id, number: scope.propRoundNumber } } });
    const account = await tx.paperTradingSession.findUniqueOrThrow({ where: { projectionId: round.projectionId } });
    return { snapshot: JSON.parse(round.snapshot), state: await hydrateStageMetrics(tx, account.id, scope.datasetId, JSON.parse(round.state)), roundNumber: round.number };
  }
  const row = await tx.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: scope.id } });
  const state: PropState = JSON.parse(row.state);
  if (state.stages.at(-1)?.metrics) return { snapshot: JSON.parse(row.snapshot), state, roundNumber: row.roundNumber };
  const account = await tx.paperTradingSession.findUniqueOrThrow({ where: { projectionId: scope.projectionId } });
  return { snapshot: JSON.parse(row.snapshot), state: await hydrateStageMetrics(tx, account.id, scope.datasetId, state), roundNumber: row.roundNumber };
}
export async function persistPropAccount(tx: Prisma.TransactionClient, runtime: PropRuntime, previous: PropState) {
  const scope = getReplayScope()!;
  if (JSON.stringify(previous) === JSON.stringify(runtime.state)) return;
  await tx.propPracticeAccount.update({ where: { replaySessionId: scope.id }, data: { state: JSON.stringify(runtime.state) } });
  const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
  await tx.propPracticeRound.updateMany({ where: { projectionId: scope.projectionId }, data: {
    state: JSON.stringify(runtime.state), trainingGate: owner.trainingGate,
    ...(runtime.state.result ? { endedAt: new Date(), endSequence: runtime.state.last?.sequence } : {}),
  } });
  const type = !previous.result && runtime.state.result ? "FAILED" : previous.phase !== runtime.state.phase ? "PROMOTED"
    : previous.pause !== runtime.state.pause ? runtime.state.pause === "NONE" ? "RESUMED" : "PAUSED" : null;
  if (type) {
    await tx.propPracticeEvent.create({ data: { replaySessionId: scope.id, roundNumber: runtime.roundNumber ?? 1, type, evidence: JSON.stringify(runtime.state) } });
    await recordReplayCommand(tx, runtime.state.last?.sequence ?? -1, `PROP_${type}`, runtime.state);
    if (type === "PROMOTED") {
      const bar = runtime.state.last ? await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: runtime.state.last.sequence } } }) : null;
      await settleGrowth(tx, { type: "EVALUATION", sourceId: "promotion", roundNumber: runtime.roundNumber ?? 1, occurredAt: bar?.timestamp ?? new Date(), source: { sequence: runtime.state.last?.sequence } });
    }
  }
}
export async function assertPropTradingAvailable(tx: Prisma.TransactionClient) {
  const prop = await loadPropAccount(tx);
  const reason = prop ? propTradingBlockReason(prop.state) : null;
  if (reason) throw new ReplaySessionError("PROP_PAUSED", 409, reason);
}
/** Observe original user operations after they finish, including same-candle close fees. */
export async function observePropOperation(tx: Prisma.TransactionClient, hadFill: boolean) {
  const prop = await loadPropAccount(tx);
  if (!prop) return;
  const scope = getReplayScope()!, before = prop.state;
  const [account, progress] = await Promise.all([tx.paperTradingSession.findFirstOrThrow({ where: accountWhere(scope.datasetId) }),
    tx.replayProgress.findFirstOrThrow({ where: progressWhere(scope.datasetId) })]);
  const bar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: progress.currentSequence } } });
  if (!bar) return;
  const day = propTradingDay(bar.timestamp, prop.snapshot.calendar);
  if (!day) { prop.state = { ...before, pause: "BOUNDARY" }; }
  else {
    const snapshot = await getPaperSessionSnapshot(scope.datasetId, tx);
    prop.state = observeProp(prop.snapshot.rules, before, { sequence: bar.sequence, day: day.day,
      rawNet: account.realizedPnl - account.totalFees, unrealized: snapshot!.stats.unrealizedPnl,
      realizedPnl: account.realizedPnl, totalFees: account.totalFees,
      flat: account.netQuantity === 0, pending: snapshot!.activeOrders.length, hadFill });
    if (day.eod && account.netQuantity === 0) prop.state = settlePropDay(prop.snapshot.rules, prop.state);
  }
  await persistPropAccount(tx, prop, before);
  // The original operation command already captured its completed trade result.
  // Attach the derived account ledger to that same checkpoint in this transaction.
  const checkpoint = await tx.replayCheckpoint.findFirst({ where: { projectionId: scope.projectionId, sourceSequence: bar.sequence }, orderBy: { commandOrdinal: "desc" } });
  if (checkpoint) {
    const state = JSON.parse(checkpoint.state);
    state.propAccount = prop;
    await tx.replayCheckpoint.update({ where: { id: checkpoint.id }, data: { state: JSON.stringify(state) } });
  }
}
export async function readPropAccount() {
  const prop = await loadPropAccount();
  if (!prop) return null;
  const scope = getReplayScope()!;
  const [payouts, events] = await Promise.all([
    prisma.propPracticePayout.findMany({ where: { replaySessionId: scope.id, roundNumber: prop.roundNumber ?? 1 }, orderBy: { createdAt: "asc" } }),
    prisma.propPracticeEvent.findMany({ where: { replaySessionId: scope.id, roundNumber: prop.roundNumber ?? 1 }, orderBy: { createdAt: "asc" } }),
  ]);
  return { ...prop, preview: payoutPreview(prop.snapshot.rules, prop.state), payouts, events };
}
export async function confirmPropPayout(input: { expectedVersion: number; requestId: string; amount: number }) {
  const scope = getReplayScope()!;
  return sqliteWriteTransaction(prisma, async (tx) => {
    const existing = await tx.propPracticePayout.findUnique({ where: { replaySessionId_requestId: { replaySessionId: scope.id, requestId: input.requestId } } });
    if (existing) {
      if (existing.amount !== input.amount) throw new ReplaySessionError("PROP_REQUEST_CONFLICT", 409, copy.propPractice.payoutInvalid);
      return existing;
    }
    await assertReplayWritable(tx);
    if (scope.version !== input.expectedVersion) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    const prop = await loadPropAccount(tx);
    if (!prop) throw new ReplaySessionError("PROP_REQUIRED", 400, copy.propPractice.invalidRules);
    const account = await tx.paperTradingSession.findFirstOrThrow({ where: accountWhere(scope.datasetId) });
    const pending = await tx.paperOrder.count({ where: { sessionId: account.id, status: "PENDING" } });
    if (account.netQuantity !== 0 || pending) throw new ReplaySessionError("PROP_NOT_FLAT", 409, copy.propPractice.mustBeFlat);
    // Complete an actual EOD before computing the permanent withdrawal floor.
    await observePropOperation(tx, false);
    const updated = (await loadPropAccount(tx))!;
    let result: ReturnType<typeof applyPayout>;
    try { result = applyPayout(updated.snapshot.rules, updated.state, input.amount); }
    catch { throw new ReplaySessionError("PROP_PAYOUT_INVALID", 409, copy.propPractice.payoutInvalid); }
    const payout = await tx.propPracticePayout.create({ data: { replaySessionId: scope.id, roundNumber: updated.roundNumber ?? 1, requestId: input.requestId,
      amount: input.amount, received: result.received, share: result.share, evidence: JSON.stringify(result.evidence) } });
    updated.state = result.state;
    await tx.propPracticeAccount.update({ where: { replaySessionId: scope.id }, data: { state: JSON.stringify(result.state) } });
    await tx.propPracticeRound.updateMany({ where: { projectionId: scope.projectionId }, data: { state: JSON.stringify(result.state) } });
    await tx.propPracticeEvent.create({ data: { replaySessionId: scope.id, roundNumber: updated.roundNumber ?? 1, type: "PAYOUT", evidence: JSON.stringify({ ...result.evidence, payoutId: payout.id }) } });
    await recordReplayCommand(tx, result.state.last!.sequence, "PROP_PAYOUT", { ...result.evidence, payoutId: payout.id, amount: input.amount, received: result.received });
    await settleGrowth(tx, { type: "PAYOUT", sourceId: payout.id, roundNumber: payout.roundNumber, occurredAt: (await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: result.state.last!.sequence } } }))?.timestamp ?? payout.createdAt,
      source: { sequence: result.state.last?.sequence, currency: updated.snapshot.currency },
      payout: { received: payout.received, currency: updated.snapshot.currency, firstInRound: await tx.propPracticePayout.count({ where: { replaySessionId: scope.id, roundNumber: payout.roundNumber } }) === 1 } });
    await markReplayMutation(tx);
    return payout;
  });
}
export async function confirmPropPromotion(input: { expectedVersion: number; requestId: string }) {
  const scope = getReplayScope()!;
  return sqliteWriteTransaction(prisma, async tx => {
    const receiptId = `prop-promotion:${scope.id}:${input.requestId}`;
    const existing = await tx.propPracticeEvent.findUnique({ where: { id: receiptId } });
    if (existing) return existing;
    await assertReplayWritable(tx);
    if (scope.version !== input.expectedVersion) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    const prop = await loadPropAccount(tx);
    if (!prop) throw new ReplaySessionError("PROP_REQUIRED", 400, copy.propPractice.invalidRules);
    // Read the completed original result, including current-close fees and pending
    // orders. Opening a preview never runs this observation or settles a day.
    await observePropOperation(tx, false);
    const updated = (await loadPropAccount(tx))!;
    let state: PropState;
    try { state = promotePropManually(updated.snapshot.rules, updated.state); }
    catch { throw new ReplaySessionError("PROP_PROMOTION_INVALID", 409, copy.propPractice.promotionUnavailable); }
    const evidence = { requestId: input.requestId, manual: true, sequence: state.last!.sequence, day: state.last!.day,
      progress: promotionPreview(updated.snapshot.rules, updated.state), state };
    await tx.propPracticeAccount.update({ where: { replaySessionId: scope.id }, data: { state: JSON.stringify(state) } });
    await tx.propPracticeRound.updateMany({ where: { projectionId: scope.projectionId }, data: { state: JSON.stringify(state) } });
    const receipt = await tx.propPracticeEvent.create({ data: { id: receiptId, replaySessionId: scope.id, roundNumber: updated.roundNumber ?? 1, type: "PROMOTED", evidence: JSON.stringify(evidence) } });
    await recordReplayCommand(tx, state.last!.sequence, "PROP_PROMOTED", evidence);
    const bar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: state.last!.sequence } } });
    await settleGrowth(tx, { type: "EVALUATION", sourceId: "promotion", roundNumber: updated.roundNumber ?? 1, occurredAt: bar?.timestamp ?? receipt.createdAt, source: { sequence: state.last!.sequence } });
    await markReplayMutation(tx);
    return receipt;
  });
}
export async function listPropTemplates() {
  return prisma.$transaction(async tx => {
    const [templates, versions] = await Promise.all([
      tx.propPracticeTemplate.findMany({ include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
      tx.propPracticeTemplateVersion.findMany({ select: { templateId: true, _count: { select: { accounts: true } } } }),
    ]);
    const counts = new Map<string, number>();
    for (const version of versions) counts.set(version.templateId, (counts.get(version.templateId) ?? 0) + version._count.accounts);
    return templates.map(template => ({ ...template, accountCount: counts.get(template.id) ?? 0 }));
  });
}
async function assertPropTemplateMutable(tx: Prisma.TransactionClient, id: string, expectedVersion: number | undefined) {
  const template = await tx.propPracticeTemplate.findUnique({ where: { id } });
  if (!template) throw new ReplaySessionError("TEMPLATE_NOT_FOUND", 404, copy.propPractice.templateMissing);
  if (template.version !== expectedVersion) throw new ReplaySessionError("TEMPLATE_CONFLICT", 409, copy.propPractice.templateConflict);
  // Include archived sessions and every legacy version, not only the current rules.
  const accounts = await tx.propPracticeAccount.count({ where: { templateVersion: { templateId: id } } });
  if (accounts) throw new ReplaySessionError("TEMPLATE_IN_USE", 409, copy.propPractice.templateInUse);
  return template;
}
export async function savePropTemplate(input: unknown, id?: string, expectedVersion?: number, active = true) {
  const rules = propRulesSchema.parse(input);
  return sqliteWriteTransaction(prisma, async tx => {
    if (!id) return tx.propPracticeTemplate.create({ data: { active, versions: { create: { version: 1, rules: JSON.stringify(rules) } } }, include: { versions: true } });
    const previous = await assertPropTemplateMutable(tx, id, expectedVersion);
    // Keep only current rules. Rotate their ID so stale account forms cannot silently
    // create an account with rules different from the ones the user selected.
    await tx.propPracticeTemplateVersion.deleteMany({ where: { templateId: id } });
    return tx.propPracticeTemplate.update({ where: { id }, data: { active, version: { increment: 1 },
      versions: { create: { version: previous.version + 1, rules: JSON.stringify(rules) } } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  });
}
export async function deletePropTemplate(id: string, expectedVersion: number) {
  return sqliteWriteTransaction(prisma, async tx => {
    await assertPropTemplateMutable(tx, id, expectedVersion);
    await tx.propPracticeTemplateVersion.deleteMany({ where: { templateId: id } });
    await tx.propPracticeTemplate.delete({ where: { id } });
  });
}
