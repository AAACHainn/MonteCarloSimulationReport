import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPLAY_CHART_VISIBILITY,
  parseReplayChartVisibility,
  toggleReplayChartVisibility,
} from "./chart-visibility";

describe("chart visibility", () => {
  it("uses visible defaults for missing or invalid preferences", () => {
    expect(parseReplayChartVisibility(null)).toEqual(DEFAULT_REPLAY_CHART_VISIBILITY);
    expect(parseReplayChartVisibility("not-json")).toEqual(DEFAULT_REPLAY_CHART_VISIBILITY);
  });

  it("preserves valid stored fields and defaults new fields to visible", () => {
    expect(parseReplayChartVisibility(JSON.stringify({ drawings: false }))).toEqual({
      drawings: false,
      indicators: true,
      tradeAnnotations: true,
    });
  });

  it("toggles one category without changing the others", () => {
    expect(toggleReplayChartVisibility(DEFAULT_REPLAY_CHART_VISIBILITY, "indicators")).toEqual({
      drawings: true,
      indicators: false,
      tradeAnnotations: true,
    });
  });

  it("hides all categories and restores all when already hidden", () => {
    const hidden = toggleReplayChartVisibility(DEFAULT_REPLAY_CHART_VISIBILITY, "all");
    expect(hidden).toEqual({ drawings: false, indicators: false, tradeAnnotations: false });
    expect(toggleReplayChartVisibility(hidden, "all")).toEqual(DEFAULT_REPLAY_CHART_VISIBILITY);
  });
});
