import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeSourceBar } from "@/lib/market-replay/dataset";
import { MAX_REPLAY_SYNC_SOURCE_BARS } from "@/lib/market-replay/types";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { getPaperSessionSnapshot, serializePaperOrder, serializePaperSession } from "@/lib/paper-trading/serialize";
import type { PaperEquityPointData, PaperFillData, PaperOrderData } from "@/lib/paper-trading/types";
import { derivePaperTradeTransitions } from "@/lib/paper-trading/reducers";
import { paperStateFingerprint } from "@/lib/paper-trading/speculative";
import type { PaperReplayDelta, ReplaySyncReceipt, ReplaySyncRequest } from "@/lib/market-replay/client-sync";
import type { PaperSessionState } from "@/lib/paper-trading/types";

export type ReplaySyncInput = {
  generation: number;
  requestId: string;
  confirmedSequence: number;
  syncVersion: number;
  expectedPaperVersion: number | null;
  targetSequence: number;
};

export type ReplaySyncSuccess = {
  requestId: string;
  currentSequence: number;
  generation: number;
  syncVersion: number;
  dataVersion: number;
  fills: PaperFillData[];
  snapshot: Awaited<ReturnType<typeof getPaperSessionSnapshot>>;
};

export type ReplaySyncOutcome =
  | { status: 200; error: null; response: ReplaySyncSuccess }
  | { status: 400 | 404 | 409; error: string; response?: never };

function orderCreateData(sessionId: string, order: PaperOrderData) {
  return {
    id: order.id, sessionId, side: order.side, type: order.type, status: order.status,
    quantity: order.quantity, riskAmount: order.riskAmount, price: order.price,
    stopLoss: order.stopLoss, takeProfit: order.takeProfit, reduceOnly: order.reduceOnly,
    isProtective: order.isProtective, ocoGroupId: order.ocoGroupId,
    createdSequence: order.createdSequence, activeFromSequence: order.activeFromSequence,
    filledSequence: order.filledSequence, filledAt: order.filledAt ? new Date(order.filledAt) : null,
    filledPrice: order.filledPrice, cancelReason: order.cancelReason,
  };
}

async function persistTrades(
  tx: Prisma.TransactionClient,
  sessionId: string,
  orders: PaperOrderData[],
  fills: PaperFillData[],
) {
  let activeTrade = fills.length
    ? await tx.paperTrade.findFirst({ where: { sessionId, status: "OPEN" } })
    : null;
  for (const transition of derivePaperTradeTransitions(orders, fills)) {
    const fill = transition.fill;
    if (transition.kind === "ENTRY") {
      activeTrade = await tx.paperTrade.create({
        data: { sessionId, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT", openedSequence: fill.sequence, openedAt: new Date(fill.timestamp), fees: fill.fee, plannedRisk: transition.plannedRisk },
      });
    } else if (transition.kind === "ADD" && activeTrade) {
      activeTrade = await tx.paperTrade.update({
        where: { id: activeTrade.id },
        data: { fees: { increment: fill.fee }, plannedRisk: transition.plannedRisk == null ? undefined : { increment: transition.plannedRisk } },
      });
    } else if (transition.kind === "REDUCE" && activeTrade) {
      activeTrade = await tx.paperTrade.update({
        where: { id: activeTrade.id },
        data: { grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee } },
      });
    } else if ((transition.kind === "CLOSE" || transition.kind === "STOP_LOSS" || transition.kind === "TAKE_PROFIT") && activeTrade) {
      await tx.paperTrade.update({
        where: { id: activeTrade.id },
        data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) },
      });
      activeTrade = null;
    } else if (transition.kind === "REVERSE") {
      const closingFee = transition.closingFee;
      if (activeTrade) {
        await tx.paperTrade.update({
          where: { id: activeTrade.id },
          data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: closingFee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) },
        });
      }
      activeTrade = await tx.paperTrade.create({
        data: { sessionId, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT", openedSequence: fill.sequence, openedAt: new Date(fill.timestamp), fees: fill.fee - closingFee, plannedRisk: transition.plannedRisk },
      });
    }
  }
}

const ACCOUNTING_EPSILON = 1e-8;

function closeEnough(actual: number | null, expected: number | null) {
  if (actual === null || expected === null) return actual === expected;
  return Math.abs(actual - expected) <= ACCOUNTING_EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function validateFillAccounting(start: PaperSessionState, delta: PaperReplayDelta) {
  let quantity = start.netQuantity;
  let average = start.averageEntryPrice;
  let realized = start.realizedPnl;
  let fees = start.totalFees;
  let slippage = start.totalSlippage;
  let previousSequence = delta.state.lastProcessedSequence - (delta.state.version - start.version);
  for (const fill of delta.fills) {
    if (fill.sequence < previousSequence || fill.sequence > delta.state.lastProcessedSequence) return false;
    previousSequence = fill.sequence;
    const signed = fill.side === "BUY" ? fill.quantity : -fill.quantity;
    const oldSign = Math.sign(quantity);
    const signedSign = Math.sign(signed);
    const nextQuantity = Math.abs(quantity + signed) <= 1e-12 ? 0 : quantity + signed;
    const closedQuantity = oldSign !== 0 && oldSign !== signedSign ? Math.min(Math.abs(quantity), fill.quantity) : 0;
    const openedQuantity = oldSign === 0 || oldSign === signedSign
      ? fill.quantity
      : Math.max(0, fill.quantity - closedQuantity);
    const fillRealized = closedQuantity > 0 ? (fill.price - Number(average)) * closedQuantity * oldSign : 0;
    let nextAverage = average;
    if (oldSign === 0 || oldSign === signedSign) {
      nextAverage = Math.abs(quantity) <= 1e-12
        ? fill.price
        : (Number(average) * Math.abs(quantity) + fill.price * fill.quantity) / (Math.abs(quantity) + fill.quantity);
    } else if (nextQuantity === 0) nextAverage = null;
    else if (Math.sign(nextQuantity) !== oldSign) nextAverage = fill.price;
    const fee = Math.abs(fill.price * fill.quantity) * start.commissionBps / 10_000;
    if (
      !closeEnough(fill.netQuantityAfter, nextQuantity)
      || !closeEnough(fill.averagePriceAfter, nextAverage)
      || !closeEnough(fill.closedQuantity, closedQuantity)
      || !closeEnough(fill.openedQuantity, openedQuantity)
      || !closeEnough(fill.realizedPnl, fillRealized)
      || !closeEnough(fill.fee, fee)
    ) return false;
    quantity = nextQuantity;
    average = nextAverage;
    realized += fillRealized;
    fees += fee;
    slippage += fill.slippageCost;
  }
  return closeEnough(delta.state.netQuantity, quantity)
    && closeEnough(delta.state.averageEntryPrice, average)
    && closeEnough(delta.state.realizedPnl, realized)
    && closeEnough(delta.state.totalFees, fees)
    && closeEnough(delta.state.totalSlippage, slippage);
}

function validateClientPaperDelta(
  datasetId: string,
  generation: number,
  confirmedSequence: number,
  targetSequence: number,
  session: PaperSessionState,
  currentOrders: PaperOrderData[],
  delta: PaperReplayDelta,
) {
  const state = delta.state;
  if (
    state.id !== session.id || state.datasetId !== datasetId
    || state.initialCapital !== session.initialCapital || state.currency !== session.currency
    || state.commissionBps !== session.commissionBps || state.slippageBps !== session.slippageBps
    || state.lastProcessedSequence !== targetSequence
    || state.version !== session.version + targetSequence - confirmedSequence
    || (Math.abs(state.netQuantity) <= 1e-12) !== (state.averageEntryPrice === null)
    || state.totalFees < session.totalFees || state.totalSlippage < session.totalSlippage
    || state.peakEquity < session.peakEquity || state.maxDrawdown < session.maxDrawdown
    || paperStateFingerprint(state, delta.activeOrders) !== delta.fingerprint
  ) return false;
  const currentOrderIds = new Set(currentOrders.map((order) => order.id));
  const changedIds = new Set<string>();
  for (const order of delta.orderChanges) {
    if (
      changedIds.has(order.id) || order.activeFromSequence < order.createdSequence
      || (!currentOrderIds.has(order.id) && !order.id.startsWith(`replay_${session.id}_${generation}_`))
      || (order.status === "FILLED" && (order.filledSequence === null || order.filledAt === null || order.filledPrice === null))
      || (order.status !== "FILLED" && order.filledSequence !== null)
    ) return false;
    changedIds.add(order.id);
    if (order.filledSequence !== null && (order.filledSequence <= confirmedSequence || order.filledSequence > targetSequence)) return false;
  }
  const finalOrders = new Map(currentOrders.map((order) => [order.id, order]));
  for (const order of delta.orderChanges) finalOrders.set(order.id, order);
  const expectedActive = [...finalOrders.values()].filter((order) => order.status === "PENDING")
    .sort((a, b) => a.id.localeCompare(b.id));
  const receivedActive = [...delta.activeOrders].sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(expectedActive) !== JSON.stringify(receivedActive)) return false;
  const fillIds = new Set<string>();
  for (const fill of delta.fills) {
    if (
      fillIds.has(fill.id) || fill.sequence <= confirmedSequence || fill.sequence > targetSequence
      || !finalOrders.has(fill.orderId)
      || !fill.id.startsWith(`replay_${session.id}_${generation}_${fill.sequence}_`)
    ) return false;
    fillIds.add(fill.id);
  }
  const equitySequences = new Set<number>();
  for (const point of delta.equityPoints) {
    if (equitySequences.has(point.sequence) || point.sequence <= confirmedSequence || point.sequence > targetSequence) return false;
    equitySequences.add(point.sequence);
  }
  return validateFillAccounting(session, delta);
}

export async function persistClientReplayBatch(
  datasetId: string,
  input: ReplaySyncRequest,
): Promise<{ status: 200; error: null; response: ReplaySyncReceipt } | { status: 400 | 404 | 409; error: string }> {
  return prisma.$transaction(async (tx) => {
    const [dataset, progress, sessionRecord] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id: datasetId } }),
      tx.replayProgress.findUnique({ where: { datasetId } }),
      tx.paperTradingSession.findUnique({ where: { datasetId } }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound } as const;
    if (progress.lastSyncRequestId === input.requestId && progress.lastSyncResponse) {
      return { status: 200, error: null, response: JSON.parse(progress.lastSyncResponse) as ReplaySyncReceipt } as const;
    }
    if (
      dataset.dataVersion !== input.dataVersion || progress.generation !== input.generation
      || progress.syncVersion !== input.syncVersion || progress.currentSequence !== input.confirmedSequence
    ) return { status: 409, error: copy.paperTrading.conflict } as const;
    if (
      input.targetSequence <= progress.currentSequence || input.targetSequence >= dataset.barCount
      || input.targetSequence - progress.currentSequence > MAX_REPLAY_SYNC_SOURCE_BARS
    ) return { status: 400, error: copy.marketReplay.validation.progressOutOfRange } as const;

    let paperVersion: number | null = null;
    let fingerprint = "no-paper-session";
    if (sessionRecord) {
      if (!input.paperDelta || sessionRecord.version !== input.expectedPaperVersion
        || sessionRecord.lastProcessedSequence !== progress.currentSequence) {
        return { status: 409, error: copy.paperTrading.conflict } as const;
      }
      const session = serializePaperSession(sessionRecord);
      const currentOrders = (await tx.paperOrder.findMany({ where: { sessionId: session.id, status: "PENDING" } }))
        .map(serializePaperOrder);
      if (!validateClientPaperDelta(datasetId, progress.generation, progress.currentSequence,
        input.targetSequence, session, currentOrders, input.paperDelta)) {
        return { status: 400, error: copy.marketReplay.syncMismatch } as const;
      }
      const delta = input.paperDelta;
      await tx.paperTradingSession.update({
        where: { id: session.id },
        data: {
          lastProcessedSequence: delta.state.lastProcessedSequence, netQuantity: delta.state.netQuantity,
          averageEntryPrice: delta.state.averageEntryPrice, realizedPnl: delta.state.realizedPnl,
          totalFees: delta.state.totalFees, totalSlippage: delta.state.totalSlippage,
          peakEquity: delta.state.peakEquity, maxDrawdown: delta.state.maxDrawdown, version: delta.state.version,
        },
      });
      for (const order of delta.orderChanges) {
        await tx.paperOrder.upsert({
          where: { id: order.id }, create: orderCreateData(session.id, order),
          update: {
            status: order.status, quantity: order.quantity, riskAmount: order.riskAmount, price: order.price,
            stopLoss: order.stopLoss, takeProfit: order.takeProfit, activeFromSequence: order.activeFromSequence,
            filledSequence: order.filledSequence, filledAt: order.filledAt ? new Date(order.filledAt) : null,
            filledPrice: order.filledPrice, cancelReason: order.cancelReason,
          },
        });
      }
      if (delta.fills.length) {
        await tx.paperFill.createMany({
          data: delta.fills.map((fill) => ({ ...fill, sessionId: session.id, timestamp: new Date(fill.timestamp) })),
        });
      }
      await persistTrades(tx, session.id, delta.orderChanges, delta.fills);
      if (delta.equityPoints.length) {
        await tx.paperEquityPoint.createMany({
          data: delta.equityPoints.map((point) => ({ ...point, sessionId: session.id, timestamp: new Date(point.timestamp) })),
        });
      }
      paperVersion = delta.state.version;
      fingerprint = delta.fingerprint;
    } else if (input.expectedPaperVersion !== null || input.paperDelta !== null) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }

    const response: ReplaySyncReceipt = {
      requestId: input.requestId, currentSequence: input.targetSequence, generation: progress.generation,
      syncVersion: progress.syncVersion + 1, dataVersion: dataset.dataVersion, paperVersion, fingerprint,
    };
    await tx.replayProgress.update({
      where: { datasetId },
      data: {
        currentSequence: input.targetSequence, syncVersion: response.syncVersion,
        lastSyncRequestId: input.requestId, lastSyncResponse: JSON.stringify(response),
      },
    });
    return { status: 200, error: null, response } as const;
  }, { timeout: 120_000 });
}

export async function syncReplayToTarget(
  datasetId: string,
  input: ReplaySyncInput,
  maximumSourceBars = MAX_REPLAY_SYNC_SOURCE_BARS,
): Promise<ReplaySyncOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    const [dataset, progress, session] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id: datasetId } }),
      tx.replayProgress.findUnique({ where: { datasetId } }),
      tx.paperTradingSession.findUnique({ where: { datasetId } }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound } as const;
    if (progress.lastSyncRequestId === input.requestId && progress.lastSyncResponse) {
      return { status: 200, error: null, response: JSON.parse(progress.lastSyncResponse) as ReplaySyncSuccess } as const;
    }
    if (
      progress.generation !== input.generation
      || progress.syncVersion !== input.syncVersion
      || progress.currentSequence !== input.confirmedSequence
    ) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }
    if (
      input.targetSequence <= progress.currentSequence
      || input.targetSequence >= dataset.barCount
      || input.targetSequence - progress.currentSequence > maximumSourceBars
    ) {
      return { status: 400, error: copy.marketReplay.validation.progressOutOfRange } as const;
    }
    const dbBars = await tx.marketBar.findMany({
      where: { datasetId, sequence: { gt: progress.currentSequence, lte: input.targetSequence } },
      orderBy: { sequence: "asc" },
    });
    if (dbBars.length !== input.targetSequence - progress.currentSequence) {
      return { status: 404, error: copy.marketReplay.loadError } as const;
    }

    const fills: PaperFillData[] = [];
    if (session) {
      if (session.version !== input.expectedPaperVersion || session.lastProcessedSequence !== progress.currentSequence) {
        return { status: 409, error: copy.paperTrading.conflict } as const;
      }
      let state = serializePaperSession(session);
      let orders = (await tx.paperOrder.findMany({
        where: { sessionId: session.id, status: "PENDING" },
        orderBy: [{ createdSequence: "asc" }, { id: "asc" }],
      })).map(serializePaperOrder);
      const originalOrders = new Map(orders.map((order) => [order.id, JSON.stringify(order)]));
      const equityPoints: PaperEquityPointData[] = [];
      for (const dbBar of dbBars) {
        const bar = serializeSourceBar(dbBar);
        const result = advancePaperTrading({
          state,
          orders,
          bar,
          makeId: createDeterministicEventIdFactory(session.id, progress.generation, bar.sequence),
        });
        state = result.state;
        orders = result.orders;
        fills.push(...result.fills);
        const shouldSample = result.fills.length > 0
          || dbBar.sequence === dataset.barCount - 1
          || dbBar.sequence % session.equitySampleStride === 0;
        if (shouldSample) equityPoints.push(result.equityPoint);
      }
      await tx.paperTradingSession.update({
        where: { id: session.id },
        data: {
          lastProcessedSequence: state.lastProcessedSequence, netQuantity: state.netQuantity,
          averageEntryPrice: state.averageEntryPrice, realizedPnl: state.realizedPnl,
          totalFees: state.totalFees, totalSlippage: state.totalSlippage,
          peakEquity: state.peakEquity, maxDrawdown: state.maxDrawdown, version: state.version,
        },
      });
      for (const order of orders) {
        if (originalOrders.get(order.id) === JSON.stringify(order)) continue;
        await tx.paperOrder.upsert({
          where: { id: order.id },
          create: orderCreateData(session.id, order),
          update: {
            status: order.status, quantity: order.quantity, riskAmount: order.riskAmount, price: order.price,
            stopLoss: order.stopLoss, takeProfit: order.takeProfit, activeFromSequence: order.activeFromSequence,
            filledSequence: order.filledSequence, filledAt: order.filledAt ? new Date(order.filledAt) : null,
            filledPrice: order.filledPrice, cancelReason: order.cancelReason,
          },
        });
      }
      if (fills.length) {
        await tx.paperFill.createMany({
          data: fills.map((fill) => ({ ...fill, sessionId: session.id, timestamp: new Date(fill.timestamp) })),
        });
      }
      await persistTrades(tx, session.id, orders, fills);
      for (let index = 0; index < equityPoints.length; index += 1_000) {
        await tx.paperEquityPoint.createMany({
          data: equityPoints.slice(index, index + 1_000).map((point) => ({
            ...point, sessionId: session.id, timestamp: new Date(point.timestamp),
          })),
        });
      }
    } else if (input.expectedPaperVersion !== null) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }

    const syncVersion = progress.syncVersion + 1;
    await tx.replayProgress.update({
      where: { datasetId },
      data: { currentSequence: input.targetSequence, syncVersion, lastSyncRequestId: input.requestId },
    });
    const response: ReplaySyncSuccess = {
      requestId: input.requestId,
      currentSequence: input.targetSequence,
      generation: progress.generation,
      syncVersion,
      dataVersion: dataset.dataVersion,
      fills,
      snapshot: await getPaperSessionSnapshot(datasetId, tx),
    };
    await tx.replayProgress.update({
      where: { datasetId },
      data: { lastSyncResponse: JSON.stringify(response) },
    });
    return { status: 200, error: null, response } as const;
  }, { timeout: 120_000 });
  return outcome;
}
