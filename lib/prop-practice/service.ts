import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { getReplayScope, assertReplayWritable, markReplayMutation, ReplaySessionError, accountWhere, progressWhere } from "@/lib/replay-sessions/scope";
import { archiveReplaySession, recordReplayCommand } from "@/lib/replay-sessions/service";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { applyPayout, payoutPreview, propRulesSchema, observeProp, settlePropDay, type PropState, type PropRules } from "./rules";
import { propTradingDay, type PropCalendar } from "./trading-day";

export type PropSnapshot = { rules: PropRules; calendar: PropCalendar; currency: string; accountConfig: import("@/lib/paper-trading/types").PaperAccountConfig };
export type PropRuntime = { snapshot: PropSnapshot; state: PropState };
export async function loadPropAccount(tx: Prisma.TransactionClient = prisma): Promise<PropRuntime | null> {
  const scope = getReplayScope();
  if (!scope || scope.accountCategory !== "PROP_PRACTICE") return null;
  const row = await tx.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: scope.id } });
  return { snapshot: JSON.parse(row.snapshot), state: JSON.parse(row.state) };
}
export async function persistPropAccount(tx: Prisma.TransactionClient, runtime: PropRuntime, previous: PropState) {
  const scope = getReplayScope()!;
  if (JSON.stringify(previous) === JSON.stringify(runtime.state)) return;
  await tx.propPracticeAccount.update({ where: { replaySessionId: scope.id }, data: { state: JSON.stringify(runtime.state) } });
  const type = !previous.result && runtime.state.result ? "FAILED" : previous.phase !== runtime.state.phase ? "PROMOTED"
    : previous.pause !== runtime.state.pause ? runtime.state.pause === "NONE" ? "RESUMED" : "PAUSED" : null;
  if (type) {
    await tx.propPracticeEvent.create({ data: { replaySessionId: scope.id, type, evidence: JSON.stringify(runtime.state) } });
    await recordReplayCommand(tx, runtime.state.last?.sequence ?? -1, `PROP_${type}`, runtime.state);
  }
  if (!previous.result && runtime.state.result === "FAILED") await archiveReplaySession(tx);
}
export async function assertPropTradingAvailable(tx: Prisma.TransactionClient) {
  const prop = await loadPropAccount(tx);
  if (prop && (prop.state.result || !["NONE", "DATA_END"].includes(prop.state.pause))) throw new ReplaySessionError("PROP_PAUSED", 409, copy.propPractice.tradingPaused);
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
    prisma.propPracticePayout.findMany({ where: { replaySessionId: scope.id }, orderBy: { createdAt: "asc" } }),
    prisma.propPracticeEvent.findMany({ where: { replaySessionId: scope.id }, orderBy: { createdAt: "asc" } }),
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
    const payout = await tx.propPracticePayout.create({ data: { replaySessionId: scope.id, requestId: input.requestId,
      amount: input.amount, received: result.received, share: result.share, evidence: JSON.stringify(result.evidence) } });
    updated.state = result.state;
    await tx.propPracticeAccount.update({ where: { replaySessionId: scope.id }, data: { state: JSON.stringify(result.state) } });
    await tx.propPracticeEvent.create({ data: { replaySessionId: scope.id, type: "PAYOUT", evidence: JSON.stringify({ ...result.evidence, payoutId: payout.id }) } });
    await recordReplayCommand(tx, result.state.last!.sequence, "PROP_PAYOUT", { ...result.evidence, payoutId: payout.id, amount: input.amount, received: result.received });
    await markReplayMutation(tx);
    return payout;
  });
}
export async function listPropTemplates() {
  return prisma.propPracticeTemplate.findMany({ include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
}
export async function savePropTemplate(input: unknown, id?: string, expectedVersion?: number, active = true) {
  const rules = propRulesSchema.parse(input);
  return sqliteWriteTransaction(prisma, async tx => {
    if (!id) return tx.propPracticeTemplate.create({ data: { active, versions: { create: { version: 1, rules: JSON.stringify(rules) } } }, include: { versions: true } });
    const previous = await tx.propPracticeTemplate.findUniqueOrThrow({ where: { id } });
    if (expectedVersion !== previous.version) throw new ReplaySessionError("TEMPLATE_CONFLICT", 409, copy.replaySessions.conflict);
    return tx.propPracticeTemplate.update({ where: { id }, data: { active, version: { increment: 1 },
      versions: { create: { version: previous.version + 1, rules: JSON.stringify(rules) } } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  });
}
