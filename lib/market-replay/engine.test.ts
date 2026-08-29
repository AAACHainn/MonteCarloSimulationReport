import { describe, expect, it } from "vitest";
import {
  createReplayState,
  findReplayStartSequence,
  getVisibleBarRange,
  playReplay,
  resetReplay,
  stepReplay,
} from "./engine";
import { REPLAY_INTERVALS, type MarketBarData } from "./types";

function bars(count: number): MarketBarData[] {
  return Array.from({ length: count }, (_, sequence) => ({
    sequence,
    timestamp: new Date(Date.UTC(2026, 0, 1, sequence)).toISOString(),
    open: sequence,
    high: sequence + 1,
    low: sequence - 1,
    close: sequence + 0.5,
    volume: null,
  }));
}

describe("market replay engine", () => {
  it("maps a requested time to the first matching or later bar", () => {
    const data = bars(5);
    expect(findReplayStartSequence(data, new Date(data[2].timestamp).getTime())).toBe(2);
    expect(findReplayStartSequence(data, new Date(data[2].timestamp).getTime() + 1)).toBe(3);
    expect(findReplayStartSequence(data, new Date(data[4].timestamp).getTime() + 1)).toBe(-1);
  });

  it("keeps the selected first replay bar hidden until the first step", () => {
    const state = createReplayState(500, 250, 1_000);
    expect(state.currentSequence).toBe(249);
    expect(getVisibleBarRange(state)).toEqual({ from: 50, to: 249 });
    expect(stepReplay(state).currentSequence).toBe(250);
  });

  it("stops at the final bar and resets to the hidden starting position", () => {
    let state = playReplay(createReplayState(3, 1, 1_000));
    state = stepReplay(state);
    expect(state.status).toBe("playing");
    state = stepReplay(state);
    expect(state).toMatchObject({ currentSequence: 2, status: "finished" });
    expect(stepReplay(state)).toEqual(state);
    expect(resetReplay(state)).toMatchObject({ currentSequence: 0, status: "paused" });
  });

  it("exposes the agreed discrete playback speeds", () => {
    expect(REPLAY_INTERVALS).toEqual([10_000, 5_000, 3_000, 1_000, 500, 200, 100]);
  });
});
