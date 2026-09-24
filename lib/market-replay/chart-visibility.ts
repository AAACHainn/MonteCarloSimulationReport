export type ReplayChartVisibility = {
  drawings: boolean;
  indicators: boolean;
  tradeAnnotations: boolean;
};

export type ReplayChartVisibilityTarget = keyof ReplayChartVisibility | "all";

export const DEFAULT_REPLAY_CHART_VISIBILITY: ReplayChartVisibility = {
  drawings: true,
  indicators: true,
  tradeAnnotations: true,
};

export function parseReplayChartVisibility(value: string | null): ReplayChartVisibility {
  if (!value) return { ...DEFAULT_REPLAY_CHART_VISIBILITY };
  try {
    const parsed = JSON.parse(value) as Partial<ReplayChartVisibility> | null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_REPLAY_CHART_VISIBILITY };
    return {
      drawings: typeof parsed.drawings === "boolean" ? parsed.drawings : true,
      indicators: typeof parsed.indicators === "boolean" ? parsed.indicators : true,
      tradeAnnotations: typeof parsed.tradeAnnotations === "boolean" ? parsed.tradeAnnotations : true,
    };
  } catch {
    return { ...DEFAULT_REPLAY_CHART_VISIBILITY };
  }
}

export function toggleReplayChartVisibility(
  current: ReplayChartVisibility,
  target: ReplayChartVisibilityTarget,
): ReplayChartVisibility {
  if (target === "all") {
    const allHidden = !current.drawings && !current.indicators && !current.tradeAnnotations;
    return {
      drawings: allHidden,
      indicators: allHidden,
      tradeAnnotations: allHidden,
    };
  }
  return { ...current, [target]: !current[target] };
}
