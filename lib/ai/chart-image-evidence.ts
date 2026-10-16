import type { ContextChart, ContextEntry, ContextValue } from "./context";
import { chartSnapshotCaption } from "@/lib/market-replay/chart-snapshot-caption";

export function chartImageDescription(chart: ContextChart) {
  return { caption: chartSnapshotCaption(chart.window), annotationVersion: chart.annotations?.version ?? null,
    annotationNumbers: chart.annotations?.mapping.map((m) => m.chartNo) ?? [],
    annotationCoverage: { verified: Boolean(chart.annotations), totalTrades: chart.annotations?.totalTrades ?? null,
      shownTrades: chart.annotations?.entries.length ?? 0, truncated: chart.annotations?.truncated ?? false } };
}
export function chartAnnotationMapping(context: ContextValue, charts: ContextChart[], reference: (entry: ContextEntry) => string) {
  const entries = new Map(context.entries.map((e) => [e.id, e]));
  const mapping = new Map(charts.flatMap((chart) => chart.annotations?.mapping ?? []).map((m) => [m.entryId, m]));
  return [...mapping.values()].map((m) => {
    const entry = entries.get(m.entryId);
    if (!entry) throw new Error("ANNOTATION_OUT_OF_SCOPE");
    return { chartNo: m.chartNo, displayNo: m.displayNo, globalNo: m.globalNo, journalAccount: m.journalAccount, tradeRef: reference(entry) };
  });
}
