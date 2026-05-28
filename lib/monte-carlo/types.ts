export type CompoundingMode = "SIMPLE_FIXED_RISK" | "COMPOUND" | "STEP_COMPOUND";
export type SamplingMethod = "BOOTSTRAP_WITH_REPLACEMENT";

export type SimulationTradeInput = {
  rMultiple: number;
};

export type SimulationConfig = {
  initialCapital: number;
  riskPercent: number;
  simulationCount: number;
  tradesPerSimulation: number;
  compoundingMode: CompoundingMode;
  stepSize?: number | null;
  ruinThreshold: number;
  samplingMethod: SamplingMethod;
};

export type EquityPoint = {
  tradeIndex: number;
  equity: number;
};

export type SimulationPath = {
  index: number;
  equityCurve: EquityPoint[];
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxLosingStreak: number;
  busted: boolean;
};

export type PercentileFinalEquity = {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};

export type HistogramBin = {
  label: string;
  start: number;
  end: number;
  count: number;
};

export type LosingStreakBin = {
  streak: number;
  count: number;
};

export type SimulationSummary = {
  profitableScenarios: number;
  losingScenarios: number;
  bustedScenarios: number;
  profitProbability: number;
  ruinProbability: number;
  averageFinalEquity: number;
  medianFinalEquity: number;
  bestFinalEquity: number;
  worstFinalEquity: number;
  percentileFinalEquity: PercentileFinalEquity;
  averageMaxDrawdown: number;
  medianMaxDrawdown: number;
  worstMaxDrawdown: number;
  bestMaxDrawdown: number;
  averageMaxLosingStreak: number;
  worstMaxLosingStreak: number;
  bestMaxLosingStreak: number;
  finalEquityHistogram: HistogramBin[];
  maxDrawdownHistogram: HistogramBin[];
  losingStreakDistribution: LosingStreakBin[];
};

export type PercentileCurves = Record<"p5" | "p25" | "p50" | "p75" | "p95", EquityPoint[]>;

export type SimulationResult = {
  config: SimulationConfig;
  summary: SimulationSummary;
  samplePaths: SimulationPath[];
  percentileCurves: PercentileCurves;
};
