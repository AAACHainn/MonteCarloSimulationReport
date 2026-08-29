import { describe, expect, it } from "vitest";
import { rangeAfterNewReplayBar } from "./chart-range";

describe("rangeAfterNewReplayBar", () => {
  it("keeps the viewport fixed when the latest bar is around the middle", () => {
    expect(rangeAfterNewReplayBar({ from: 20, to: 120 }, 70)).toEqual({ from: 20, to: 120 });
  });

  it("moves one logical position when the user is following the right edge", () => {
    expect(rangeAfterNewReplayBar({ from: 20, to: 120 }, 116)).toEqual({ from: 21, to: 121 });
  });

  it("does not jump to realtime when the latest bar is outside the historical viewport", () => {
    expect(rangeAfterNewReplayBar({ from: 20, to: 80 }, 120)).toEqual({ from: 20, to: 80 });
  });
});
