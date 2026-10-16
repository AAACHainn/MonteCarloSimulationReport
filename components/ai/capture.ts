"use client";
import type { ContextValue } from "@/lib/ai/context";
import { aiApi } from "./api";
import type { ContextChart } from "@/lib/ai/context";
import type { CaptureRenderContext, CaptureJob } from "@/lib/ai/chart-images-contract";
import { selectChartAnnotations } from "@/lib/ai/chart-images-contract";

export async function captureChartImage(context: CaptureRenderContext, chart: ContextChart, signal: AbortSignal) {
  const { createChartSnapshotRenderer } = await import("@/lib/market-replay/chart-snapshot");
  const { capturePdfChartPreferences } = await import("@/components/market-replay/use-replay-preferences");
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:2400px;height:1200px;pointer-events:none";
  document.body.appendChild(container);
  const preferences = context.chartPreferences ?? capturePdfChartPreferences({ id: context.datasetId, startTime: context.asOfTime, timezone: context.timezone });
  const renderer = createChartSnapshotRenderer(container, preferences, context.tick, { ...context.display, displayIntervalSeconds: chart.intervalSeconds ?? context.display.displayIntervalSeconds });
  try {
    const bars = chart.window.bars;
    const annotations = chart.annotations ?? selectChartAnnotations(context, chart);
    const result = await renderer.capture(chart.window, { fromSequence: bars[0].firstSequence, toSequence: bars.at(-1)!.lastSequence, count: bars.length, entryIds: annotations.entries.map((e) => e.id), beforeCount: 0, afterCount: 0, part: 1, parts: 1 }, annotations.entries, signal);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
      reader.readAsDataURL(new Blob([result.png], { type: "image/png" }));
    });
  } finally { renderer.remove(); container.remove(); }
}
export async function fulfillChartCapture(job: CaptureJob, signal: AbortSignal) {
  const dataUrl = await captureChartImage(job.context, job.chart, signal);
  signal.throwIfAborted();
  return aiApi("captures/" + job.id, "POST", { lease: job.lease, dataUrl }, signal);
}

export async function captureContextCharts(context: ContextValue & { id: string }, signal: AbortSignal) {
  const prepared = await aiApi<Array<{ id: string; chartHash: string }>>("contexts/" + context.id + "/assets", "GET", undefined, signal);
  const ids: string[] = [];
  for (const chart of context.charts) {
    signal.throwIfAborted();
    const existing = prepared.find((asset) => asset.chartHash === chart.hash);
    if (existing) { ids.push(existing.id); continue; }
    const dataUrl = await captureChartImage(context, chart, signal);
    const asset = await aiApi<{ id: string }>("assets", "POST", { dataUrl, contextId: context.id, chartHash: chart.hash }, signal);
    ids.push(asset.id);
  }
  return ids;
}
