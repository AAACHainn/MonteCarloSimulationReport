import { describe, expect, it } from "vitest";
import { simulateMonteCarlo } from "./simulate";
import type { SimulationConfig } from "./types";

const baseConfig: SimulationConfig = {
  initialCapital: 10_000,
  riskPercent: 1,
  simulationCount: 2,
  tradesPerSimulation: 3,
  compoundingMode: "SIMPLE_FIXED_RISK",
  ruinThreshold: 9_700,
  samplingMethod: "BOOTSTRAP_WITH_REPLACEMENT",
};

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

describe("simulateMonteCarlo", () => {
  it("calculates fixed-risk paths, drawdown, busts, and streaks", () => {
    const result = simulateMonteCarlo(
      baseConfig,
      [{ rMultiple: 1 }, { rMultiple: -2 }],
      { rng: sequence([0.1, 0.6, 0.6, 0.1, 0.1, 0.1]), samplePathLimit: 2 },
    );

    expect(result.samplePaths).toHaveLength(2);
    expect(result.samplePaths[0].index).toBe(1);
    expect(result.samplePaths[0].finalEquity).toBe(9_706);
    expect(result.samplePaths[0].maxDrawdown).toBe(394);
    expect(result.summary.worstMaxLosingStreak).toBe(2);
    expect(result.samplePaths[0].busted).toBe(false);
    expect(result.summary.profitableScenarios).toBe(1);
    expect(result.summary.bustedScenarios).toBe(0);
    expect(result.summary.percentileFinalEquity.p50).toBe(10_000);
  });

  it("uses current equity for compound mode", () => {
    const result = simulateMonteCarlo(
      {
        ...baseConfig,
        simulationCount: 1,
        tradesPerSimulation: 2,
        compoundingMode: "COMPOUND",
      },
      [{ rMultiple: 1 }],
      { rng: () => 0 },
    );

    expect(result.samplePaths[0].equityCurve.map((point) => Math.round(point.equity))).toEqual([
      10_000,
      10_100,
      10_201,
    ]);
  });

  it("uses floored equity steps for step compound mode", () => {
    const result = simulateMonteCarlo(
      {
        ...baseConfig,
        simulationCount: 1,
        tradesPerSimulation: 1,
        compoundingMode: "STEP_COMPOUND",
        stepSize: 1_000,
      },
      [{ rMultiple: 1 }],
      { rng: () => 0 },
    );

    expect(result.samplePaths[0].finalEquity).toBe(10_100);
  });
});
