import { accountBalance } from "@/lib/paper-trading/account-funds";
import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";
import type { PaperTradingSession, ReplayCommand, ReplayCorrectionJob } from "@prisma/client";
import { copy } from "@/lib/i18n";
import { ReplaySessionError, runWithReplayScope, type ReplayScope } from "./scope";
import { cloneCheckpointPrefix } from "./copy-prefix";
import { REPLAY_CHECKPOINT_STRIDE, saveReplayCheckpoint } from "./checkpoint";
import { applyRecordedCommand, type RecordedPayload } from "./replay-command";
import { projectionRecordId } from "./identity";
import { persistDerivedBatch } from "./persistence";
import { persistContextRuns } from "./context-storage";
import { materializeFlatContexts } from "./flat-context";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { serializeSourceBar } from "@/lib/market-replay/dataset";
import { serializePaperOrder, serializePaperPositionLot, serializePaperSession } from "@/lib/paper-trading/serialize";
import type { PaperOrderData, PaperJournalContext, PaperFillData, ReplayJournalEntryDraft, PaperEquityPointData } from "@/lib/paper-trading/types";
import { endCorrection } from "./corrections";
import { pruneReplayResults } from "./prune-results";

async function stillRunning(jobId: string) {
  const job = await prisma.replayCorrectionJob.findUnique({ where: { id: jobId }, select: { status: true } });
  return job?.status === "RUNNING";
}
async function* commandsInRange(projectionId: string, from: number, to: number, afterOrdinal: number) {
  let cursor: { sourceSequence: number; ordinal: number; id: string } | null = null;
  while (true) {
    const commands: ReplayCommand[] = await prisma.replayCommand.findMany({
      where: { projections: { some: { projectionId } }, sourceSequence: { gte: from, lte: to },
        AND: [
          { OR: [{ sourceSequence: { gt: from } }, { sourceSequence: from, ordinal: { gt: afterOrdinal } }] },
          ...(cursor ? [{ OR: [{ sourceSequence: { gt: cursor.sourceSequence } }, { sourceSequence: cursor.sourceSequence, ordinal: { gt: cursor.ordinal } }, { sourceSequence: cursor.sourceSequence, ordinal: cursor.ordinal, id: { gt: cursor.id } }] }] : []),
        ],
      }, orderBy: [{ sourceSequence: "asc" }, { ordinal: "asc" }, { id: "asc" }], take: 1000,
    });
    if (!commands.length) break;
    for (const command of commands) yield command;
    cursor = commands.at(-1)!;
  }
}

async function filterCommand(job: ReplayCorrectionJob, command: ReplayCommand, baseAccount: PaperTradingSession | null, cache: Map<string, boolean>) {
  if (job.type !== "DELETE_CYCLE" || !baseAccount) return command;
  const payload = JSON.parse(command.payload) as RecordedPayload;
  async function excluded(id: string) {
    if (cache.has(id)) return cache.get(id)!;
    const order = await prisma.paperOrder.findUnique({ where: { id: projectionRecordId(job.baseProjectionId, id) }, select: { parentOrderId: true } });
    const root = order?.parentOrderId ?? id;
    const found = await prisma.paperFill.findFirst({ where: { sessionId: baseAccount!.id, cycleKey: job.cycleKey, orderId: projectionRecordId(job.baseProjectionId, root) }, select: { id: true } });
    if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
    cache.set(id, Boolean(found)); return Boolean(found);
  }
  if (payload.order && await excluded(payload.order.id)) return null;
  if (payload.orderIds) {
    const kept: string[] = [];
    for (const id of payload.orderIds) if (!await excluded(id)) kept.push(id);
    if (!kept.length) return null;
    if (kept.length !== payload.orderIds.length) return {
      ...command, id: randomUUID(), payload: JSON.stringify({ ...payload, orderIds: kept }),
    };
  }
  return command;
}

export async function runReplayCorrection(jobId: string) {
  const claimed = await prisma.replayCorrectionJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "RUNNING", workerPid: process.pid, heartbeatAt: new Date() } });
  if (!claimed.count) return;
  try {
    const job = await prisma.replayCorrectionJob.findUniqueOrThrow({ where: { id: jobId } });
    const session = await prisma.replaySession.findUniqueOrThrow({ where: { id: job.replaySessionId }, include: { progress: true, dataset: true } });
    if (session.pendingCorrectionId !== jobId || session.activeProjectionId !== job.baseProjectionId || !session.progress || session.dataset.historyVersion !== job.historyVersion) {
      throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    }
    const summary = JSON.parse(job.summary) as { fallbackTargetSequence?: number };
    const boundary = job.type === "DELETE_CYCLE" ? summary.fallbackTargetSequence! : job.targetSequence;
    const checkpoint = await prisma.replayCheckpoint.findFirst({ where: { projectionId: job.baseProjectionId,
      // Current-price fills occur after candle matching. Start before that
      // source candle so prefix copying cannot retain its later user fills.
      OR: [{ sourceSequence: { lt: boundary } }, ...(boundary < 0 ? [{ sourceSequence: boundary, commandOrdinal: 0 }] : [])] },
      orderBy: [{ sourceSequence: "desc" }, { commandOrdinal: "desc" }],
    });
    if (!checkpoint) throw new ReplaySessionError("HISTORY_MISSING", 409, copy.replaySessions.correctionHistoryMissing);
    const generation = session.progress.generation + 1;
    const projection = await prisma.$transaction(async (tx) => {
      const currentJob = await tx.replayCorrectionJob.findUniqueOrThrow({ where: { id: jobId } });
      if (currentJob.status !== "RUNNING") return null;
      const draft = await tx.replayProjection.create({ data: {
        replaySessionId: session.id, status: "BUILDING", historyVersion: job.historyVersion,
        currentSequence: checkpoint.sourceSequence,
      } });
      await tx.replayCorrectionJob.update({ where: { id: jobId }, data: { targetProjectionId: draft.id, totalSourceBars: job.targetSequence - checkpoint.sourceSequence } });
      return draft;
    });
    if (!projection) return;
    const scope: ReplayScope = { id: session.id, datasetId: session.datasetId, projectionId: projection.id, mode: "LIVE_REPLAY", status: "ACTIVE", version: session.version };
    const baseAccount = await prisma.paperTradingSession.findUnique({ where: { projectionId: job.baseProjectionId } });
    await runWithReplayScope(scope, async () => {
      let account = await cloneCheckpointPrefix(job.baseProjectionId, projection.id, checkpoint);
      const cache = new Map<string, boolean>();
      let removedCommands = 0;
      let cursor = checkpoint.sourceSequence;
      let commandOrdinal = checkpoint.commandOrdinal;
      let referencePrice = cursor >= 0 ? (await prisma.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: session.datasetId, sequence: cursor } }, select: { close: true } }))?.close ?? null : null;
      async function applyCommand(command: ReplayCommand, original: ReplayCommand) {
        if (command.id !== original.id) removedCommands += 1;
        // Persist filtered intent and its draft link together so cancellation
        // cannot leave a command outside either retained result.
        account = await prisma.$transaction(async (tx) => {
          if (command.id !== original.id) await tx.replayCommand.create({ data: command });
          return applyRecordedCommand(tx, command, account, referencePrice);
        });
      }
      // Commands after a restored checkpoint run before its next source candle.
      async function applyCommands(from: number, to: number, afterOrdinal: number) {
        for await (const original of commandsInRange(job.baseProjectionId, from, to, afterOrdinal)) {
          if (job.type === "REWIND" && original.sourceSequence === job.targetSequence) continue;
          const command = await filterCommand(job, original, baseAccount, cache);
          if (!command) { removedCommands += 1; continue; }
          await applyCommand(command, original);
          commandOrdinal = command.ordinal;
        }
      }
      await applyCommands(cursor, cursor, commandOrdinal);
      while (cursor < job.targetSequence) {
        if (!await stillRunning(jobId)) return;
        const end = Math.min(job.targetSequence, cursor + REPLAY_CHECKPOINT_STRIDE);
        const bars = await prisma.marketBar.findMany({ where: { datasetId: session.datasetId, sequence: { gt: cursor, lte: end } }, orderBy: { sequence: "asc" } });
        if (bars.length !== end - cursor) throw new ReplaySessionError("HISTORY_MISSING", 409, copy.replaySessions.correctionHistoryMissing);
        const commandStream = commandsInRange(job.baseProjectionId, cursor + 1, end, 0);
        let nextCommand = await commandStream.next();
        const storedContexts = await prisma.replayContextRun.findMany({ where: { projectionId: job.baseProjectionId, fromSequence: { lte: end }, toSequence: { gt: cursor } }, orderBy: { fromSequence: "asc" } });
        const contexts = await materializeFlatContexts(session.dataset, bars, storedContexts);
        let contextIndex = 0;
        for (let offset = 0; offset < bars.length;) {
          const changed = new Map<string, PaperOrderData>();
          const fills: PaperFillData[] = []; const entries: ReplayJournalEntryDraft[] = []; const equityPoints: PaperEquityPointData[] = [];
          let state = account ? serializePaperSession(account) : null;
          let orders = account ? (await prisma.paperOrder.findMany({ where: { sessionId: account.id, status: "PENDING" } })).map(serializePaperOrder) : [];
          let lots = account ? (await prisma.paperPositionLot.findMany({ where: { sessionId: account.id } })).map(serializePaperPositionLot) : [];
          const originalOrders = new Map(orders.map((order) => [order.id, JSON.stringify(order)]));
          const firstSequence = bars[offset].sequence;
          for (; offset < bars.length; offset += 1) {
            if (offset % 256 === 0) {
              const alive = await prisma.replayCorrectionJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { heartbeatAt: new Date() } });
              if (!alive.count) return;
            }
            const raw = bars[offset]; const bar = serializeSourceBar(raw);
            while (contextIndex < contexts.length && contexts[contextIndex].toSequence < bar.sequence) contextIndex += 1;
            const run = contexts[contextIndex];
            if (state) {
              if (!run || run.fromSequence > bar.sequence) throw new ReplaySessionError("HISTORY_MISSING", 409, copy.replaySessions.correctionHistoryMissing);
              const metadata = JSON.parse(run.context) as { generation: number; context: PaperJournalContext | null };
              const result = advancePaperTrading({ state, orders, lots, bar, makeId: createDeterministicEventIdFactory(state.id, metadata.generation, bar.sequence), journalContext: metadata.context });
              state = result.state; lots = result.lots;
              for (const order of result.orders) if (originalOrders.get(order.id) !== JSON.stringify(order)) changed.set(order.id, order);
              orders = result.orders.filter((order) => order.status === "PENDING");
              fills.push(...result.fills); entries.push(...result.journalEntries);
              if (result.fills.length || bar.sequence === job.targetSequence || bar.sequence % account!.equitySampleStride === 0) equityPoints.push(result.equityPoint);
            }
            cursor = bar.sequence; referencePrice = bar.close; commandOrdinal = 0;
            const hasCommands = !nextCommand.done && nextCommand.value.sourceSequence === cursor;
            if (hasCommands || fills.length >= 1000 || entries.length >= 1000) { offset += 1; break; }
          }
          await prisma.$transaction(async (tx) => {
            if (account && state) account = await persistDerivedBatch(tx, account, generation, { state, orders: [...changed.values()], fills, lots, entries, equityPoints });
            const runs = contexts.filter((run) => run.toSequence >= firstSequence && run.fromSequence <= cursor).map((run) => {
              const metadata = JSON.parse(run.context) as { generation: number; context: PaperJournalContext | null };
              return { ...metadata, fromSequence: Math.max(firstSequence, run.fromSequence), toSequence: Math.min(cursor, run.toSequence) };
            });
            await persistContextRuns(tx, runs);
            await tx.replayProjection.update({ where: { id: projection.id }, data: { currentSequence: cursor } });
            await saveReplayCheckpoint(tx, cursor);
          }, { timeout: 120_000 });
          while (!nextCommand.done && nextCommand.value.sourceSequence === cursor) {
            const original = nextCommand.value;
            nextCommand = await commandStream.next();
            if (job.type === "REWIND" && cursor === job.targetSequence) continue;
            const command = await filterCommand(job, original, baseAccount, cache);
            if (!command) { removedCommands += 1; continue; }
            await applyCommand(command, original);
          }
        }
        await prisma.replayCorrectionJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { heartbeatAt: new Date(), processedSourceBars: cursor - checkpoint.sourceSequence } });
      }
      if (!await stillRunning(jobId)) return;
      if (session.dataset.historyVersion !== (await prisma.marketDataset.findUniqueOrThrow({ where: { id: session.datasetId }, select: { historyVersion: true } })).historyVersion) {
        throw new ReplaySessionError("HISTORY_CHANGED", 409, copy.marketSync.historyChanged);
      }
      const after = await prisma.paperTradingSession.findUnique({ where: { projectionId: projection.id } });
      const [beforeEntries, afterEntries] = await Promise.all([
        prisma.replayJournalEntry.count({ where: { projectionId: job.baseProjectionId } }), prisma.replayJournalEntry.count({ where: { projectionId: projection.id } }),
      ]);
      const stats = (a: PaperTradingSession | null) => a ? ({ currency: a.currency, balance: accountBalance(a), netQuantity: a.netQuantity,
        realizedPnl: a.realizedPnl, totalFees: a.totalFees, totalSlippage: a.totalSlippage, peakEquity: a.peakEquity, maxDrawdown: a.maxDrawdown, tradeCount: a.closedTradeCount }) : null;
      await prisma.replayCorrectionJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "READY", heartbeatAt: new Date(), summary: JSON.stringify({
        ...summary, before: stats(baseAccount), after: stats(after), beforeEntries, afterEntries, removedCommands,
        originalSequence: session.progress!.currentSequence, targetSequence: job.targetSequence, maxSourceChunk: REPLAY_CHECKPOINT_STRIDE,
      }) } });
    });
  } catch (error) {
    await endCorrection(jobId, "FAILED", error instanceof ReplaySessionError ? error.message : copy.replaySessions.requestFailed);
    if (!(error instanceof ReplaySessionError)) console.error("Replay correction failed.", error);
  } finally {
    // A worker may notice cancellation after an in-flight copy. Sweep again
    // after it exits, preserving any newer pending correction's draft.
    await prisma.$transaction(async (tx) => {
      const job = await tx.replayCorrectionJob.findUnique({ where: { id: jobId } });
      if (job && ["APPLIED", "CANCELLED", "FAILED", "INTERRUPTED"].includes(job.status)) {
        await pruneReplayResults(tx, job.replaySessionId);
      }
    }, { timeout: 120_000 });
  }
}
