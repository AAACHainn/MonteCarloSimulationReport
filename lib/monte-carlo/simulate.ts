import {
  average,
  buildHistogram,
  buildStreakDistribution,
  median,
  percentile,
} from "./stats";
import type {
  EquityPoint,
  PercentileCurves,
  SimulationConfig,
  SimulationPath,
  SimulationResult,
  SimulationTradeInput,
} from "./types";

type SimulateOptions = {
  rng?: () => number;
  samplePathLimit?: number;
};

const CURVE_PERCENTILES = [5, 25, 50, 75, 95] as const;

function riskBaseForTrade(config: SimulationConfig, currentEquity: number) {
  if (config.compoundingMode === "SIMPLE_FIXED_RISK") {
    return config.initialCapital;
  }

  if (config.compoundingMode === "STEP_COMPOUND") {
    const stepSize = config.stepSize ?? 0;
    if (stepSize <= 0) return currentEquity;
    return Math.max(stepSize, Math.floor(currentEquity / stepSize) * stepSize);
  }

  return currentEquity;
}

function calculateMaxDrawdown(equityCurve: EquityPoint[]) {
  let peak = equityCurve[0]?.equity ?? 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak - point.equity;
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
  }

  return { maxDrawdown, maxDrawdownPct };
}

function emptyPercentileCurves(): PercentileCurves {
  return {
    p5: [],
    p25: [],
    p50: [],
    p75: [],
    p95: [],
  };
}

export function simulateMonteCarlo(
  config: SimulationConfig,
  trades: SimulationTradeInput[],
  options: SimulateOptions = {},
): SimulationResult {
  if (trades.length === 0) {
    throw new Error("At least one trade with a valid R-multiple is required.");
  }

  const rng = options.rng ?? Math.random;
  const samplePathLimit = options.samplePathLimit ?? 100;
  const rMultiples = trades.map((trade) => trade.rMultiple).filter(Number.isFinite);
  const percentileBuckets = Array.from({ length: config.tradesPerSimulation + 1 }, () => [] as number[]);
  const samplePaths: SimulationPath[] = [];
  const allPaths: Omit<SimulationPath, "equityCurve">[] = [];

  for (let simIndex = 0; simIndex < config.simulationCount; simIndex += 1) {
    let currentEquity = config.initialCapital;
    let currentLosingStreak = 0;
    let maxLosingStreak = 0;
    let busted = currentEquity < config.ruinThreshold;
    const equityCurve: EquityPoint[] = [{ tradeIndex: 0, equity: currentEquity }];
    percentileBuckets[0].push(currentEquity);

    for (let tradeIndex = 1; tradeIndex <= config.tradesPerSimulation; tradeIndex += 1) {
      const sampleIndex = Math.floor(rng() * rMultiples.length);
      const rMultiple = rMultiples[Math.min(sampleIndex, rMultiples.length - 1)];
      const riskBase = riskBaseForTrade(config, currentEquity);
      const riskAmount = riskBase * (config.riskPercent / 100);
      const pnl = riskAmount * rMultiple;

      currentEquity += pnl;
      busted ||= currentEquity < config.ruinThreshold;

      if (pnl < 0) {
        currentLosingStreak += 1;
        maxLosingStreak = Math.max(maxLosingStreak, currentLosingStreak);
      } else {
        currentLosingStreak = 0;
      }

      equityCurve.push({ tradeIndex, equity: currentEquity });
      percentileBuckets[tradeIndex].push(currentEquity);
    }

    const { maxDrawdown, maxDrawdownPct } = calculateMaxDrawdown(equityCurve);
    const finalEquity = currentEquity;
    const totalReturnPct = ((finalEquity - config.initialCapital) / config.initialCapital) * 100;
    const path: SimulationPath = {
      index: simIndex + 1,
      equityCurve,
      finalEquity,
      totalReturnPct,
      maxDrawdown,
      maxDrawdownPct,
      maxLosingStreak,
      busted,
    };

    if (samplePaths.length < samplePathLimit) {
      samplePaths.push(path);
    }

    allPaths.push({
      index: path.index,
      finalEquity,
      totalReturnPct,
      maxDrawdown,
      maxDrawdownPct,
      maxLosingStreak,
      busted,
    });
  }

  const finalEquities = allPaths.map((path) => path.finalEquity);
  const sortedFinalEquities = [...finalEquities].sort((a, b) => a - b);
  const maxDrawdowns = allPaths.map((path) => path.maxDrawdown);
  const maxLosingStreaks = allPaths.map((path) => path.maxLosingStreak);
  const profitableScenarios = finalEquities.filter((value) => value > config.initialCapital).length;
  const bustedScenarios = allPaths.filter((path) => path.busted).length;
  const percentileCurves = emptyPercentileCurves();

  percentileBuckets.forEach((bucket, tradeIndex) => {
    const sorted = bucket.sort((a, b) => a - b);
    for (const pct of CURVE_PERCENTILES) {
      percentileCurves[`p${pct}` as keyof PercentileCurves].push({
        tradeIndex,
        equity: percentile(sorted, pct),
      });
    }
  });

  return {
    config,
    samplePaths,
    percentileCurves,
    summary: {
      profitableScenarios,
      losingScenarios: config.simulationCount - profitableScenarios,
      bustedScenarios,
      profitProbability: (profitableScenarios / config.simulationCount) * 100,
      ruinProbability: (bustedScenarios / config.simulationCount) * 100,
      averageFinalEquity: average(finalEquities),
      medianFinalEquity: median(finalEquities),
      bestFinalEquity: Math.max(...finalEquities),
      worstFinalEquity: Math.min(...finalEquities),
      percentileFinalEquity: {
        p5: percentile(sortedFinalEquities, 5),
        p25: percentile(sortedFinalEquities, 25),
        p50: percentile(sortedFinalEquities, 50),
        p75: percentile(sortedFinalEquities, 75),
        p95: percentile(sortedFinalEquities, 95),
      },
      averageMaxDrawdown: average(maxDrawdowns),
      medianMaxDrawdown: median(maxDrawdowns),
      worstMaxDrawdown: Math.max(...maxDrawdowns),
      bestMaxDrawdown: Math.min(...maxDrawdowns),
      averageMaxLosingStreak: average(maxLosingStreaks),
      worstMaxLosingStreak: Math.max(...maxLosingStreaks),
      bestMaxLosingStreak: Math.min(...maxLosingStreaks),
      finalEquityHistogram: buildHistogram(finalEquities),
      maxDrawdownHistogram: buildHistogram(maxDrawdowns),
      losingStreakDistribution: buildStreakDistribution(maxLosingStreaks),
    },
  };
}
