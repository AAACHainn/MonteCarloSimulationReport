import { REPLAY_INITIAL_VISIBLE_BARS, type AggregatedMarketBarData } from "./types";

export type ReplayDisplayWindow = { bars: AggregatedMarketBarData[]; warmupBars: AggregatedMarketBarData[] };

/** Historical viewport data is never a substitute for the confirmed live ABR context. */
export function replayCalculationWindow(display: ReplayDisplayWindow, detached: boolean, live: ReplayDisplayWindow | null) {
  return detached && live ? live : display;
}

/** A detached chart needs only a bounded live tail plus the configured indicator prefix. */
export function retainReplayCalculationWindow(window: ReplayDisplayWindow, warmupCount: number): ReplayDisplayWindow {
  const cut = Math.max(0, window.bars.length - REPLAY_INITIAL_VISIBLE_BARS);
  return {
    bars: cut ? window.bars.slice(cut) : window.bars,
    warmupBars: warmupCount > 0
      ? [...window.warmupBars, ...window.bars.slice(0, cut)].slice(-warmupCount) : [],
  };
}
