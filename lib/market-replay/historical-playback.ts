import { aggregatePhase } from "./bar-quality";
import type { ChartHideAfter } from "./chart-hide-after";
import type { AggregatedMarketBarData, DisplaySession } from "./types";
import { isPlaybackRate } from "./types";

export type HistoricalPlaybackState = {
  active: boolean;
  boundary: ChartHideAfter | null;
  playing: boolean;
  busy: boolean;
  finished: boolean;
  rate: number;
  error: string | null;
};

/** A page cutoff must not masquerade as a complete displayed step. */
export function isHistoricalPlaybackBarReady(bar: AggregatedMarketBarData, endSequence: number) {
  return bar.lastSequence <= endSequence && (aggregatePhase(bar) === "CLOSED" || bar.lastSequence === endSequence);
}

/** View-only cursor. Never writes replay progress, preferences or trading state. */
export function createHistoricalPlayback(options: {
  endSequence: number;
  getTimeline: () => { bars: AggregatedMarketBarData[]; seconds: number; session: DisplaySession };
  readLater: (after: number, signal: AbortSignal) => Promise<AggregatedMarketBarData[]>;
  loadFailed: string;
}) {
  let state: HistoricalPlaybackState = {
    active: false, boundary: null, playing: false, busy: false, finished: false, rate: 8, error: null,
  };
  let epoch = 0;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  function update(patch: Partial<HistoricalPlaybackState>) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  }
  function cancel() {
    epoch += 1;
    controller?.abort();
    controller = null;
  }
  function pause() { cancel(); update({ playing: false, busy: false }); }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    start(target: ChartHideAfter) {
      if (target.bar.lastSequence > options.endSequence) return;
      cancel();
      update({ active: true, boundary: target, playing: false, busy: false,
        finished: target.bar.lastSequence >= options.endSequence, error: null });
    },
    hide(target: ChartHideAfter | null) {
      cancel();
      update({ active: false, boundary: target, playing: false, busy: false, finished: false, error: null });
    },
    exit() {
      cancel();
      update({ active: false, boundary: null, playing: false, busy: false, finished: false, error: null });
    },
    pause,
    timelineChanged() {
      cancel();
      update({ playing: false, busy: false, error: null,
        finished: state.active && state.boundary !== null && state.boundary.bar.lastSequence >= options.endSequence });
    },
    toggle() {
      if (state.playing) pause();
      else if (state.active && !state.finished) update({ playing: true, error: null });
    },
    setRate(rate: number) { if (isPlaybackRate(rate)) update({ rate }); },
    async step() {
      if (!state.active || !state.boundary || state.busy || state.finished) return;
      const token = epoch;
      const after = state.boundary.bar.lastSequence;
      const timeline = options.getTimeline();
      const nextBar = (bars: AggregatedMarketBarData[]) => bars.find(bar =>
        bar.lastSequence > after && isHistoricalPlaybackBarReady(bar, options.endSequence));
      const request = new AbortController();
      controller = request;
      update({ busy: true, error: null });
      try {
        const next = nextBar(timeline.bars) ?? nextBar(await options.readLater(after, request.signal));
        if (token !== epoch || request.signal.aborted) return;
        if (!next) update({ playing: false, finished: true });
        else update({ boundary: { bar: { ...next }, displayIntervalSeconds: timeline.seconds, displaySession: timeline.session },
          finished: next.lastSequence >= options.endSequence,
          ...(next.lastSequence >= options.endSequence ? { playing: false } : {}) });
      } catch (cause) {
        if (token === epoch && !request.signal.aborted) update({ playing: false,
          error: cause instanceof Error && cause.message ? cause.message : options.loadFailed });
      } finally {
        if (token === epoch) { controller = null; update({ busy: false }); }
      }
    },
  };
}

/** Archived rounds must never inherit the current round's later progress. */
export function historicalReplayEndSequence(input: {
  barCount: number; roundEnd: number | null; projectionSequence: number; progressSequence: number | null; activeProjection: boolean;
}) {
  const end = input.roundEnd ?? (input.activeProjection ? input.progressSequence ?? input.projectionSequence : input.projectionSequence);
  return Math.min(input.barCount - 1, end);
}
