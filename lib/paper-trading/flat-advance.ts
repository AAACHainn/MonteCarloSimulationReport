import { accountBalance, tradingBalance } from "./account-funds";
import type { PaperEquityPointData, PaperSessionState } from "./types";

/** Include protective, market and not-yet-active orders in pendingCount. */
export function canAdvanceFlatAccount(state: Pick<PaperSessionState, "netQuantity" | "averageEntryPrice" | "activeCycleKey">,
  pendingCount: number, lotCount: number) {
  return state.netQuantity === 0 && state.averageEntryPrice === null && !state.activeCycleKey
    && pendingCount === 0 && lotCount === 0;
}

/** Exact equivalent of advancing a constant, flat equity curve source by source. */
export function advanceFlatAccount(state: PaperSessionState, targetSequence: number): PaperSessionState {
  if (!canAdvanceFlatAccount(state, 0, 0) || targetSequence <= state.lastProcessedSequence) throw new Error("Invalid flat advance.");
  const equity = tradingBalance(state);
  const peakEquity = Math.max(state.peakEquity, equity);
  const drawdown = peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity) : 0;
  return { ...state, lastProcessedSequence: targetSequence, version: state.version + targetSequence - state.lastProcessedSequence,
    peakEquity, maxDrawdown: Math.max(state.maxDrawdown, drawdown) };
}

export function flatEquityPoint(state: PaperSessionState, sequence: number, timestamp: string): PaperEquityPointData {
  const equity = tradingBalance(state);
  return { sequence, timestamp, balance: accountBalance(state), equity: accountBalance(state),
    drawdown: state.peakEquity > 0 ? Math.max(0, (state.peakEquity - equity) / state.peakEquity) : 0 };
}

/** Preserve both sparse sampling and the former 100-source manual commit samples. */
export function flatSampleSequences(from: number, to: number, stride: number, preserveSyncSamples = true) {
  const samples = new Set<number>([to]);
  for (let sequence = Math.ceil((from + 1) / stride) * stride; sequence <= to; sequence += stride) samples.add(sequence);
  if (preserveSyncSamples) for (let sequence = from + 100; sequence <= to; sequence += 100) samples.add(sequence);
  return [...samples].sort((a, b) => a - b);
}
