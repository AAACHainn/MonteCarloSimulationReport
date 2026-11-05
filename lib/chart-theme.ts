import type { DeepPartial, ChartOptions, ColorType } from "lightweight-charts";
import type { AppearanceMode } from "@/lib/appearance";
import { appearancePalette } from "@/lib/appearance-palette";

const light = {
  background: "#ffffff", text: "#475569", grid: "#f1f5f9", border: "#e2e8f0",
  crosshair: "#9598a1", crosshairLabelBackground: "#4c525e", crosshairLabelText: "#ffffff",
  selection: "#2962FF", handle: "#ffffff", annotationBackground: "rgba(255,255,255,.86)",
  annotationWash: "rgba(255,255,255,.5)", annotationText: "#334155", countdown: "#1d4ed8",
  positive: "#16a34a", negative: "#dc2626", buy: "#2563eb", sell: "#ea580c",
  tradeColors: ["#2563eb", "#d97706", "#059669", "#dc2626", "#7c3aed"],
  percentiles: { p5: "#dc2626", p25: "#f59e0b", p50: "#2563eb", p75: "#0d9488", p95: "#16a34a" },
  samplePath: "#64748b", samplePathOpacity: 0.22,
  tooltipBackground: "#ffffff", tooltipText: "#334155", tooltipBorder: "#e2e8f0",
};
export type ChartTheme = typeof light;
const dark: ChartTheme = {
  background: appearancePalette.dark.chartBackground, text: appearancePalette.dark.secondaryText,
  grid: "#243041", border: appearancePalette.dark.border,
  crosshair: appearancePalette.dark.mutedForeground, crosshairLabelBackground: appearancePalette.dark.hover,
  crosshairLabelText: appearancePalette.dark.foreground, selection: appearancePalette.dark.link,
  handle: appearancePalette.dark.surfaceRaised, annotationBackground: appearancePalette.dark.surfaceRaised,
  annotationWash: "rgba(27,37,51,.85)", annotationText: appearancePalette.dark.foreground,
  countdown: appearancePalette.dark.link, positive: appearancePalette.dark.positive,
  negative: appearancePalette.dark.negative, buy: appearancePalette.dark.link, sell: "#FDBA74",
  tradeColors: [appearancePalette.dark.link, appearancePalette.dark.warning, appearancePalette.dark.positive, appearancePalette.dark.negative, "#A78BFA"],
  percentiles: { p5: "#F87171", p25: "#FBBF24", p50: "#7AB0FF", p75: "#2DD4BF", p95: "#4ADE80" },
  samplePath: "#94A3B8", samplePathOpacity: 0.35,
  tooltipBackground: appearancePalette.dark.surfaceRaised, tooltipText: appearancePalette.dark.foreground,
  tooltipBorder: appearancePalette.dark.border,
};
export const chartThemes = { light, dark };
export const resolveChartTheme = (mode: AppearanceMode): ChartTheme => chartThemes[mode];

// Only appearance options: never data, scale margins, grid visibility or viewport.
export function chartThemeOptions(theme: ChartTheme): DeepPartial<ChartOptions> {
  return {
    layout: { background: { type: "solid" as ColorType.Solid, color: theme.background }, textColor: theme.text,
      panes: { separatorColor: theme.border, separatorHoverColor: theme.crosshairLabelBackground } },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    timeScale: { borderColor: theme.border }, rightPriceScale: { borderColor: theme.border },
    crosshair: {
      vertLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshairLabelBackground },
      horzLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshairLabelBackground },
    },
  };
}

export function chartTooltipStyle(theme: ChartTheme) {
  return { backgroundColor: theme.tooltipBackground, borderColor: theme.tooltipBorder, color: theme.tooltipText };
}
