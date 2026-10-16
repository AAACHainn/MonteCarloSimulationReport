import { cancelUncheckedEntries, countGateEntry, settleGateEntries } from "./training-gate";
import type {
  PaperAdvanceInput,
  PaperAdvanceResult,
  PaperFillData,
  PaperFillReason,
  PaperOrderData,
  PaperSessionState,
  PaperSide,
} from "./types";
import { closeLotsFifo, DEFAULT_PAPER_JOURNAL_CONTEXT, updateLotAdverseRisk } from "./journal";
import { entryLotId } from "./journal-identity";

const EPSILON = 1e-12;

function sign(value: number) {
  return value > EPSILON ? 1 : value < -EPSILON ? -1 : 0;
}

function orderDelta(side: PaperSide, quantity: number) {
  return side === "BUY" ? quantity : -quantity;
}

function compareOrders(a: PaperOrderData, b: PaperOrderData) {
  return a.createdSequence - b.createdSequence || a.id.localeCompare(b.id);
}

function isMarketable(order: PaperOrderData, price: number) {
  if (order.type === "LIMIT") return order.side === "BUY" ? price <= Number(order.price) : price >= Number(order.price);
  if (order.type === "STOP") return order.side === "BUY" ? price >= Number(order.price) : price <= Number(order.price);
  return false;
}

function triggerOnSegment(order: PaperOrderData, from: number, to: number) {
  if (order.type === "MARKET" || order.price === null || from === to) return null;
  const upward = to > from;
  if (order.type === "LIMIT") {
    if (order.side === "BUY" && !upward && order.price <= from && order.price >= to) return order.price;
    if (order.side === "SELL" && upward && order.price >= from && order.price <= to) return order.price;
  } else {
    if (order.side === "BUY" && upward && order.price >= from && order.price <= to) return order.price;
    if (order.side === "SELL" && !upward && order.price <= from && order.price >= to) return order.price;
  }
  return null;
}

function applySlippage(basePrice: number, side: PaperSide, bps: number) {
  const multiplier = side === "BUY" ? 1 + bps / 10_000 : 1 - bps / 10_000;
  return basePrice * multiplier;
}

function cancelProtectiveOrders(orders: PaperOrderData[], reason: string, exceptId?: string) {
  for (const order of orders) {
    if (order.status === "PENDING" && order.isProtective && order.id !== exceptId) {
      order.status = "CANCELLED";
      order.cancelReason = reason;
    }
  }
}

function syncProtectiveQuantity(orders: PaperOrderData[], quantity: number) {
  for (const order of orders) {
    if (order.status === "PENDING" && order.isProtective) order.quantity = quantity;
  }
}

function createBracket(
  orders: PaperOrderData[],
  parent: PaperOrderData,
  state: PaperSessionState,
  sequence: number,
  makeId: (cause?: string) => string,
) {
  cancelProtectiveOrders(orders, "REPLACED");
  if (sign(state.netQuantity) === 0) return;
  const side: PaperSide = state.netQuantity > 0 ? "SELL" : "BUY";
  const group = makeId(`oco:${parent.id}`);
  const common = {
    status: "PENDING" as const,
    side,
    quantity: Math.abs(state.netQuantity),
    riskAmount: null,
    stopLoss: null,
    takeProfit: null,
    reduceOnly: true,
    isProtective: true,
    ocoGroupId: group,
    parentOrderId: parent.id,
    createdSequence: sequence,
    activeFromSequence: sequence,
    filledSequence: null,
    filledAt: null,
    filledPrice: null,
    cancelReason: null,
  };
  if (parent.stopLoss !== null) {
    orders.push({ ...common, id: makeId(`stop:${parent.id}`), type: "STOP", price: parent.stopLoss });
  }
  if (parent.takeProfit !== null) {
    orders.push({ ...common, id: makeId(`target:${parent.id}`), type: "LIMIT", price: parent.takeProfit });
  }
}

function fillReason(oldQuantity: number, newQuantity: number, order: PaperOrderData): PaperFillReason {
  if (order.isProtective) return order.type === "STOP" ? "STOP_LOSS" : "TAKE_PROFIT";
  if (sign(oldQuantity) === 0) return "ENTRY";
  if (sign(oldQuantity) === sign(newQuantity) && Math.abs(newQuantity) > Math.abs(oldQuantity)) return "ADD";
  if (sign(newQuantity) === 0) return "CLOSE";
  if (sign(oldQuantity) !== sign(newQuantity)) return "REVERSE";
  return "REDUCE";
}

export function advancePaperTrading(input: PaperAdvanceInput): PaperAdvanceResult {
  const state = { ...input.state, ...(input.state.trainingGate ? { trainingGate: { ...input.state.trainingGate } } : {}) };
  const orders = input.orders.map((order) => ({ ...order }));
  const fills: PaperFillData[] = [];
  let lots = (input.lots ?? []).map((lot) => ({ ...lot }));
  let journalTrackingBlocked = sign(state.netQuantity) !== 0 && lots.length === 0;
  const journalEntries = [] as PaperAdvanceResult["journalEntries"];
  const journalContext = input.journalContext ?? DEFAULT_PAPER_JOURNAL_CONTEXT;
  const { bar, makeId } = input;
  if (bar.sequence !== state.lastProcessedSequence + 1) throw new Error("Paper trading can only advance one bar at a time.");

  function execute(order: PaperOrderData, basePrice: number) {
    let quantity = order.quantity;
    const oldQuantity = state.netQuantity;
    if (order.reduceOnly) {
      const compatible = oldQuantity > 0 ? order.side === "SELL" : oldQuantity < 0 ? order.side === "BUY" : false;
      if (!compatible) {
        order.status = "CANCELLED";
        order.cancelReason = "NO_POSITION";
        return;
      }
      quantity = Math.min(quantity, Math.abs(oldQuantity));
    }
    if (quantity <= EPSILON) {
      order.status = "CANCELLED";
      order.cancelReason = "ZERO_QUANTITY";
      return;
    }

    const usesSlippage = order.type === "MARKET" || order.type === "STOP";
    const price = usesSlippage ? applySlippage(basePrice, order.side, state.slippageBps) : basePrice;
    const delta = orderDelta(order.side, quantity);
    const oldSign = sign(oldQuantity);
    const deltaSign = sign(delta);
    let closedQuantity = 0;
    let openedQuantity = 0;
    let realizedPnl = 0;
    let nextQuantity = oldQuantity + delta;
    let nextAverage = state.averageEntryPrice;

    if (oldSign === 0 || oldSign === deltaSign) {
      openedQuantity = quantity;
      const oldAbsolute = Math.abs(oldQuantity);
      nextAverage = oldAbsolute <= EPSILON
        ? price
        : ((Number(state.averageEntryPrice) * oldAbsolute) + price * quantity) / (oldAbsolute + quantity);
    } else {
      closedQuantity = Math.min(Math.abs(oldQuantity), quantity);
      realizedPnl = (price - Number(state.averageEntryPrice)) * closedQuantity * oldSign;
      openedQuantity = Math.max(0, quantity - closedQuantity);
      if (Math.abs(nextQuantity) <= EPSILON) {
        nextQuantity = 0;
        nextAverage = null;
      } else if (sign(nextQuantity) !== oldSign) {
        nextAverage = price;
      }
    }

    const fillId = makeId(`fill:${order.id}`);
    const feePerUnit = Math.abs(price) * state.commissionBps / 10_000;
    const closed = closedQuantity > EPSILON && lots.length > 0 ? closeLotsFifo(lots, closedQuantity, {
      fillId, sequence: bar.sequence, timestamp: bar.timestamp, price, feePerUnit,
    }) : null;
    const gateWasActive = state.trainingGate?.active ?? false;
    if (state.trainingGate && closed) state.trainingGate = settleGateEntries(state.trainingGate, closed.completedNetResults, bar.sequence);
    // A reverse may close the second losing entry. Permit that close, but never
    // open its unchecked remainder after the gate has become active.
    if (state.trainingGate?.active && openedQuantity > EPSILON && !order.discipline) {
      if (closedQuantity <= EPSILON) {
        order.status = "CANCELLED"; order.cancelReason = "TRAINING_GATE_REQUIRED";
        return;
      }
      quantity = closedQuantity; openedQuantity = 0; nextQuantity = 0; nextAverage = null;
      order.stopLoss = null; order.takeProfit = null;
    }
    const fee = Math.abs(price * quantity) * state.commissionBps / 10_000;
    const slippageCost = Math.abs(price - basePrice) * quantity;
    state.netQuantity = nextQuantity;
    state.averageEntryPrice = nextAverage;
    state.realizedPnl += realizedPnl;
    state.totalFees += fee;
    state.totalSlippage += slippageCost;

    order.status = "FILLED";
    order.quantity = quantity;
    order.filledSequence = bar.sequence;
    order.filledAt = bar.timestamp;
    order.filledPrice = price;
    if (order.ocoGroupId) {
      for (const sibling of orders) {
        if (sibling.id !== order.id && sibling.status === "PENDING" && sibling.ocoGroupId === order.ocoGroupId) {
          sibling.status = "CANCELLED";
          sibling.cancelReason = "OCO_FILLED";
        }
      }
    }

    const directionChanged = oldSign !== 0 && sign(nextQuantity) !== 0 && oldSign !== sign(nextQuantity);
    if (sign(nextQuantity) === 0 || directionChanged) cancelProtectiveOrders(orders, sign(nextQuantity) === 0 ? "POSITION_CLOSED" : "POSITION_REVERSED", order.id);
    else syncProtectiveQuantity(orders, Math.abs(nextQuantity));
    if (!order.isProtective && (order.stopLoss !== null || order.takeProfit !== null)) {
      createBracket(orders, order, state, bar.sequence, makeId);
    }

    const fill: PaperFillData = {
      id: fillId, orderId: order.id, sequence: bar.sequence, timestamp: bar.timestamp,
      side: order.side, price, quantity, fee, slippageCost, realizedPnl,
      closedQuantity, openedQuantity, netQuantityAfter: nextQuantity,
      averagePriceAfter: nextAverage, reason: fillReason(oldQuantity, nextQuantity, order),
    };
    fill.cycleKey = oldSign === 0 ? fill.id : state.activeCycleKey ?? `legacy-cycle:${state.id}`;
    state.activeCycleKey = sign(nextQuantity) === 0 ? null : fill.cycleKey;
    fills.push(fill);

    if (closed) {
      lots = closed.lots;
      journalEntries.push(...closed.entries.map((entry) => ({ ...entry, cycleKey: fill.cycleKey })));
    }
    if (state.trainingGate?.active && !gateWasActive) {
      state.trainingGate.cancelledOrderCount += cancelUncheckedEntries(orders, state.netQuantity, order.id);
    }
    if (state.trainingGate && openedQuantity > EPSILON) state.trainingGate = countGateEntry(state.trainingGate);
    if (journalTrackingBlocked && closedQuantity >= Math.abs(oldQuantity) - EPSILON) {
      journalTrackingBlocked = false;
    }
    if (openedQuantity > EPSILON && !journalTrackingBlocked) {
      lots.push({
        id: entryLotId(fill.id),
        entryFillId: fill.id,
        ...(state.trainingGate ? { entryNetPnl: -feePerUnit * openedQuantity } : {}),
        ...(order.discipline ? { discipline: order.discipline } : {}),
        side: nextQuantity > 0 ? "LONG" : "SHORT",
        openedSequence: fill.sequence,
        openedAt: fill.timestamp,
        entryPrice: fill.price,
        entryOrderType: order.type,
        initialStopPrice: order.stopLoss,
        initialQuantity: openedQuantity,
        remainingQuantity: openedQuantity,
        initialRisk: order.stopLoss === null ? null : Math.abs(fill.price - order.stopLoss),
        actualRisk: 0,
        ...journalContext,
      });
    }
  }

  function processAtPrice(price: number, includeMarket: boolean) {
    while (true) {
      const candidates = orders.filter((order) => order.status === "PENDING"
        && order.activeFromSequence <= bar.sequence
        && ((includeMarket && order.type === "MARKET") || isMarketable(order, price)))
        .sort(compareOrders);
      const candidate = candidates[0];
      if (!candidate) break;
      execute(candidate, price);
    }
  }

  updateLotAdverseRisk(lots, bar.open);
  processAtPrice(bar.open, true);
  const path = bar.close > bar.open
    ? [bar.open, bar.low, bar.high, bar.close]
    : [bar.open, bar.high, bar.low, bar.close];
  for (let index = 0; index < path.length - 1; index += 1) {
    let cursor = path[index];
    const end = path[index + 1];
    while (cursor !== end) {
      const candidates = orders.flatMap((order) => {
        if (order.status !== "PENDING" || order.activeFromSequence > bar.sequence) return [];
        const trigger = triggerOnSegment(order, cursor, end);
        return trigger === null ? [] : [{ order, trigger }];
      }).sort((a, b) => {
        const distance = Math.abs(a.trigger - cursor) - Math.abs(b.trigger - cursor);
        return distance || compareOrders(a.order, b.order);
      });
      const candidate = candidates[0];
      if (!candidate) {
        updateLotAdverseRisk(lots, end);
        break;
      }
      cursor = candidate.trigger;
      updateLotAdverseRisk(lots, cursor);
      execute(candidate.order, candidate.trigger);
      processAtPrice(cursor, false);
    }
  }

  state.lastProcessedSequence = bar.sequence;
  state.version += 1;
  const balance = state.initialCapital + state.realizedPnl - state.totalFees;
  const unrealized = state.averageEntryPrice === null ? 0 : (bar.close - state.averageEntryPrice) * state.netQuantity;
  const equity = balance + unrealized;
  state.peakEquity = Math.max(state.peakEquity, equity);
  const drawdown = state.peakEquity > 0 ? Math.max(0, (state.peakEquity - equity) / state.peakEquity) : 0;
  state.maxDrawdown = Math.max(state.maxDrawdown, drawdown);

  return {
    state,
    orders,
    fills,
    lots,
    journalEntries,
    equityPoint: { sequence: bar.sequence, timestamp: bar.timestamp, balance, equity, drawdown },
  };
}
