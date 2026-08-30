import {
  REPLAY_HISTORY_BARS,
  type MarketBarData,
  type PlaybackRate,
  type ReplayState,
} from "./types";

export function findReplayStartSequence(bars: MarketBarData[], timestampMs: number) {
  let low = 0;
  let high = bars.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (new Date(bars[middle].timestamp).getTime() < timestampMs) low = middle + 1;
    else high = middle;
  }

  return low < bars.length ? low : -1;
}

export function createReplayState(
  barCount: number,
  startSequence: number,
  playbackRate: PlaybackRate,
  displayIntervalSeconds: number,
  currentSequence = startSequence - 1,
): ReplayState {
  const finished = currentSequence >= barCount - 1;
  return {
    barCount,
    startSequence,
    currentSequence,
    playbackRate,
    displayIntervalSeconds,
    status: finished ? "finished" : "paused",
  };
}

export function playReplay(state: ReplayState): ReplayState {
  if (state.currentSequence >= state.barCount - 1) return { ...state, status: "finished" };
  return { ...state, status: "playing" };
}

export function pauseReplay(state: ReplayState): ReplayState {
  if (state.status === "finished") return state;
  return { ...state, status: "paused" };
}

export function stepReplay(state: ReplayState): ReplayState {
  if (state.currentSequence >= state.barCount - 1) return { ...state, status: "finished" };
  const currentSequence = state.currentSequence + 1;
  return {
    ...state,
    currentSequence,
    status: currentSequence >= state.barCount - 1 ? "finished" : state.status,
  };
}

export function setPlaybackRate(state: ReplayState, playbackRate: PlaybackRate): ReplayState {
  return { ...state, playbackRate };
}

export function setDisplayInterval(state: ReplayState, displayIntervalSeconds: number): ReplayState {
  return { ...state, displayIntervalSeconds };
}

export function resetReplay(state: ReplayState): ReplayState {
  return { ...state, currentSequence: state.startSequence - 1, status: "paused" };
}

export function calculatePlaybackAdvance(
  accumulator: number,
  elapsedMs: number,
  playbackRate: number,
  sourceIntervalSeconds: number,
  maximum = 100,
) {
  const nextAccumulator = accumulator + elapsedMs * playbackRate / (sourceIntervalSeconds * 1_000);
  const count = Math.min(maximum, Math.max(0, Math.floor(nextAccumulator)));
  return { count, accumulator: nextAccumulator - count };
}

export function getVisibleBarRange(state: ReplayState) {
  return {
    from: Math.max(0, state.startSequence - REPLAY_HISTORY_BARS),
    to: state.currentSequence,
  };
}
