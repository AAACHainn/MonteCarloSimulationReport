import type { ContextValue, ContextChart } from "./context";
import { PDF_MAX_BARS, type PdfChartPreferences } from "@/lib/paper-trading/pdf-types";
import { parseSourceInterval } from "@/lib/market-replay/types";
import { buildReplayTradePriceAnnotations } from "@/lib/market-replay/trade-annotation-primitive";
import { REPLAY_TRADE_ANNOTATION_LIMIT } from "@/lib/paper-trading/trade-annotations";
import type { ReplayTradeAnnotationData } from "@/lib/paper-trading/types";

export type ImageRequest = { multiple: boolean; timeframes: string[] };
export const AI_CHART_MAX_BARS = PDF_MAX_BARS;
export const AI_CHART_ANNOTATION_VERSION = 1;
export type ChartAnnotations = {
  version: typeof AI_CHART_ANNOTATION_VERSION;
  entries: ReplayTradeAnnotationData[];
  mapping: Array<{ entryId: string; chartNo: number; displayNo: number; globalNo: number; journalAccount: string }>;
  totalTrades: number; truncated: boolean;
};
export function selectChartAnnotations(context: Pick<ContextValue, "entries" | "currentChart" | "endSequence" | "chartPlans">, chart: ContextChart): ChartAnnotations {
  const cutoff = Math.min(context.endSequence, context.chartPlans?.find((p) => p.entryId === chart.entryId && p.intervalSeconds === chart.intervalSeconds)?.endSequence ?? context.endSequence);
  const duplicateNumbers = new Set(context.entries.map((e) => e.no)).size !== context.entries.length;
  const ordered = [...context.entries].sort((a, b) => a.globalNo - b.globalNo || a.id.localeCompare(b.id));
  const numbers = new Map(ordered.map((e, i) => [e.id, duplicateNumbers ? i + 1 : e.no]));
  const current = chart.entryId === context.currentChart?.id;
  const visible = ordered.filter((e) => (current || e.id === chart.entryId) && e.closedSequence <= cutoff
    && buildReplayTradePriceAnnotations(e).some((a) => chart.window.bars.some((b) => a.sequence >= b.firstSequence && a.sequence <= b.lastSequence)));
  const selected = visible.slice(-REPLAY_TRADE_ANNOTATION_LIMIT);
  return { version: AI_CHART_ANNOTATION_VERSION, totalTrades: visible.length, truncated: selected.length < visible.length,
    entries: selected.map((e) => ({ id: e.id, no: numbers.get(e.id)!, direction: e.direction, entryOrderType: e.entryOrderType,
      openedSequence: e.openedSequence, closedSequence: e.closedSequence, entryPrice: e.entryPrice, initialStopPrice: e.initialStopPrice, actualRisk: e.actualRisk, exitPrice: e.exitPrice, result: e.result })),
    mapping: selected.map((e) => ({ entryId: e.id, chartNo: numbers.get(e.id)!, displayNo: e.no, globalNo: e.globalNo, journalAccount: e.journalSessionId })) };
}
export const chartWarmupCount = (preferences?: PdfChartPreferences) => preferences?.emaEnabled
  ? Math.min(1000, Math.max(0, ...preferences.emaIndicators.filter((indicator) => indicator.visible).map((indicator) => indicator.length * 3))) : 0;
export type CaptureRenderContext = Pick<ContextValue, "datasetId" | "asOfTime" | "timezone" | "tick" | "display" | "chartPreferences" | "entries" | "currentChart" | "endSequence"> & { id: string };
export type CaptureJob = { id: string; lease: string; deadline: number; context: CaptureRenderContext; chart: ContextChart };
export function requestedCharts(context: ContextValue, request: ImageRequest) {
  if (context.depth === "full") return context.charts;
  return context.charts.filter((chart) => {
    const seconds = chart.intervalSeconds ?? context.display.displayIntervalSeconds;
    if (request.timeframes.length) return request.timeframes.some((t) => parseSourceInterval(t) === seconds);
    const subject = context.currentChart?.id === chart.entryId ? context.currentChart : context.entries.find((e) => e.id === chart.entryId);
    return seconds === (subject?.displayIntervalSeconds ?? context.display.displayIntervalSeconds);
  });
}
