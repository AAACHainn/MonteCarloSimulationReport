import type {
  PaperAdvanceResult,
  PaperEquityPointData,
  PaperFillData,
  PaperOrderData,
  PaperPositionLotData,
  ReplayJournalEntryDraft,
  PaperSessionSnapshot,
  PaperSessionState,
} from "@/lib/paper-trading/types";
import { paperStateFingerprint } from "@/lib/paper-trading/speculative";

export type PaperReplayDelta = {
  state: PaperSessionState;
  activeOrders: PaperOrderData[];
  orderChanges: PaperOrderData[];
  fills: PaperFillData[];
  equityPoints: PaperEquityPointData[];
  openLots: PaperPositionLotData[];
  journalEntries: ReplayJournalEntryDraft[];
  fingerprint: string;
};

export type ReplaySyncRequest = {
  generation: number;
  requestId: string;
  confirmedSequence: number;
  syncVersion: number;
  dataVersion: number;
  expectedPaperVersion: number | null;
  targetSequence: number;
  paperDelta: PaperReplayDelta | null;
};

export type ReplaySyncReceipt = {
  requestId: string;
  currentSequence: number;
  generation: number;
  syncVersion: number;
  dataVersion: number;
  paperVersion: number | null;
  fingerprint: string;
};

export type PaperDeltaAccumulator = {
  fromSequence: number;
  toSequence: number;
  orderChanges: Map<string, PaperOrderData>;
  fills: PaperFillData[];
  equityPoints: PaperEquityPointData[];
  journalEntries: ReplayJournalEntryDraft[];
};

export function createPaperDeltaAccumulator(sequence: number): PaperDeltaAccumulator {
  return { fromSequence: sequence, toSequence: sequence, orderChanges: new Map(), fills: [], equityPoints: [], journalEntries: [] };
}

export function recordPaperAdvance(
  accumulator: PaperDeltaAccumulator,
  previous: PaperSessionSnapshot,
  result: PaperAdvanceResult,
  shouldSampleEquity: boolean,
) {
  const previousOrders = new Map([
    ...previous.activeOrders,
    ...previous.recentOrders,
  ].map((order) => [order.id, JSON.stringify(order)]));
  for (const order of result.orders) {
    if (previousOrders.get(order.id) !== JSON.stringify(order)) accumulator.orderChanges.set(order.id, order);
  }
  accumulator.toSequence = result.state.lastProcessedSequence;
  accumulator.fills.push(...result.fills);
  accumulator.journalEntries.push(...result.journalEntries);
  if (shouldSampleEquity) accumulator.equityPoints.push(result.equityPoint);
}

export function buildPaperReplayDelta(
  accumulator: PaperDeltaAccumulator,
  snapshot: PaperSessionSnapshot,
): PaperReplayDelta {
  return {
    state: snapshot.session,
    activeOrders: snapshot.activeOrders,
    orderChanges: [...accumulator.orderChanges.values()],
    fills: accumulator.fills,
    equityPoints: accumulator.equityPoints,
    openLots: snapshot.openLots ?? [],
    journalEntries: accumulator.journalEntries,
    fingerprint: paperStateFingerprint(snapshot.session, snapshot.activeOrders, snapshot.openLots ?? []),
  };
}

export function mergePaperDeltaAccumulators(
  earlier: PaperDeltaAccumulator,
  later: PaperDeltaAccumulator,
): PaperDeltaAccumulator {
  const orderChanges = new Map(earlier.orderChanges);
  for (const [id, order] of later.orderChanges) orderChanges.set(id, order);
  return {
    fromSequence: earlier.fromSequence,
    toSequence: later.toSequence,
    orderChanges,
    fills: [...earlier.fills, ...later.fills],
    equityPoints: [...earlier.equityPoints, ...later.equityPoints],
    journalEntries: [...earlier.journalEntries, ...later.journalEntries],
  };
}
