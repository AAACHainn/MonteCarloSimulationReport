"use client";
import type { ContextValue } from "@/lib/ai/context";
import { aiApi } from "./api";

export async function captureContextCharts(context: ContextValue & { id: string }, signal: AbortSignal) {
  const [{ createChartSnapshotRenderer }, { capturePdfChartPreferences }] = await Promise.all([
    import("@/lib/market-replay/chart-snapshot"),
    import("@/components/market-replay/use-replay-preferences"),
  ]);
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:2400px;height:1200px;pointer-events:none";
  document.body.appendChild(container);
  const preferences = context.chartPreferences ?? capturePdfChartPreferences({ id: context.datasetId, startTime: context.entries[0]?.openedAt ?? context.asOfTime, timezone: context.timezone });
  const ids: string[] = [];
  try {
    const prepared = await aiApi<Array<{ id: string; chartHash: string }>>("contexts/" + context.id + "/assets", "GET", undefined, signal);
    for (const chart of context.charts) {
      signal.throwIfAborted();
      const existing = prepared.find((asset) => asset.chartHash === chart.hash);
      if (existing) { ids.push(existing.id); continue; }
      const renderer = createChartSnapshotRenderer(container, preferences, context.tick, { ...context.display, displayIntervalSeconds: chart.intervalSeconds ?? context.display.displayIntervalSeconds });
      try {
      const bars = chart.window.bars;
      const result = await renderer.capture(chart.window, {
        fromSequence: bars[0].firstSequence, toSequence: bars.at(-1)!.lastSequence,
        count: bars.length, entryIds: [chart.entryId], beforeCount: 0, afterCount: 0, part: 1, parts: context.charts.length,
      }, context.entries, signal);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
        reader.readAsDataURL(new Blob([result.png], { type: "image/png" }));
      });
      const asset = await aiApi<{ id: string }>("assets", "POST", { dataUrl, contextId: context.id, chartHash: chart.hash }, signal);
      ids.push(asset.id);
      } finally { renderer.remove(); }
    }
    return ids;
  } finally { container.remove(); }
}
