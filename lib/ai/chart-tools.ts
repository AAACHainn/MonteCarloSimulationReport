import { z } from "zod";
import { prisma } from "@/lib/db";
import { readExportWindow, planExportWindow } from "@/lib/market-replay/export-window";
import { formatInterval, parseSourceInterval } from "@/lib/market-replay/types";
import { hashValue, chartSourceTimes, annotatedChart, type ContextChart, type ChartSubject } from "./context";
import { displayIntervalOptions } from "@/lib/market-replay/display-interval";
import { decodeCursor, encodeCursor, resourceRef, sourceReceipt, tradeRef, toolFailure, toolSuccess, type Receipt, type ToolEnvelope, type ToolScope } from "./tools";
import { AI_CHART_MAX_BARS, AI_CHART_ANNOTATION_VERSION, chartWarmupCount, type ImageRequest } from "./chart-images-contract";
import { chartImageDescription, chartAnnotationMapping } from "./chart-image-evidence";
import { copy } from "@/lib/i18n";

export const chartArguments = z.object({ chartRef: z.string().min(1).max(160).nullable(), timeframes: z.array(z.string().max(20)).min(1).max(4).nullable(), cursor: z.string().max(2000).nullable() }).strict();
export const chartRef = (scope: ToolScope, entry: ChartSubject) => scope.context.chartAccess || scope.context.chartPlans?.some((p) => p.entryId === entry.id) ? resourceRef(scope, "chart-context", entry.logicalKey) : null;
function imagePolicy(scope: ToolScope): ImageRequest {
  const requested = scope.imageRequest?.timeframes ?? scope.context.imageTimeframes ?? [];
  return { multiple: scope.imageRequest?.multiple ?? requested.length > 1, timeframes: requested };
}
export function chartDirectory(scope: ToolScope, entry: ChartSubject) {
  const policy = imagePolicy(scope), original = formatInterval(entry.displayIntervalSeconds);
  const defaults = policy.timeframes.length ? policy.timeframes : [original];
  const supported = scope.context.chartAccess ? displayIntervalOptions(scope.context.sourceSeconds, entry.displayIntervalSeconds).map(formatInterval)
    : scope.context.chartPlans?.filter((p) => p.entryId === entry.id).map((p) => formatInterval(p.intervalSeconds)) ?? [];
  const allowed = policy.multiple && !policy.timeframes.length ? supported : defaults;
  return { chartRef: chartRef(scope, entry), originalTimeframe: original, defaultTimeframes: defaults,
    availableTimeframes: supported.filter((t) => allowed.some((a) => parseSourceInterval(a) === parseSourceInterval(t))),
    multipleImagesAllowed: policy.multiple, output: "IMAGES_ONLY", maxImagesPerPage: 4, maxBarsPerImage: AI_CHART_MAX_BARS };
}
type ImageAsset = { id: string; bytes: number; contentHash: string | null };
type Capture = (variantId: string, chart: ContextChart) => Promise<ImageAsset>;
export async function executeChartTool(scope: ToolScope, contextId: string, raw: unknown, signal: AbortSignal, allowedAssetIds: string[], capture?: Capture): Promise<{ result: ToolEnvelope; images: Array<{ assetId: string; sourceRef: string }> }> {
  const fail = (code: string) => ({ result: toolFailure(scope, code), images: [] });
  const parsed = chartArguments.safeParse(raw); if (!parsed.success) return fail("INVALID_ARGUMENTS");
  const a = parsed.data, c = scope.context;
  const subject = a.chartRef ? [...c.entries, ...(c.currentChart ? [c.currentChart] : [])].find((e) => chartRef(scope, e) === a.chartRef)
    : c.currentChart ?? c.entries.find((e) => e.id === c.selectedEntryId);
  if (!subject) return fail("NOT_FOUND_IN_SCOPE");
  const directory = chartDirectory(scope, subject);
  const seconds = [...new Set((a.timeframes ?? directory.defaultTimeframes).map(parseSourceInterval))];
  if (seconds.some((s) => s === null || !directory.availableTimeframes.some((t) => parseSourceInterval(t) === s))) return fail("UNSUPPORTED_TIMEFRAME");
  if (seconds.length > 1 && !directory.multipleImagesAllowed) return fail("MULTIPLE_IMAGES_NOT_REQUESTED");
  const binding = ["get_chart_images", chartRef(scope, subject), seconds, AI_CHART_MAX_BARS, AI_CHART_ANNOTATION_VERSION], offset = decodeCursor(scope, binding, a.cursor);
  if (offset === null || offset > 100) return fail("INVALID_CURSOR");
  const normalized = seconds.map((s) => formatInterval(s!)), charts: Record<string, unknown>[] = [], sources: Receipt[] = [], images: Array<{ assetId: string; sourceRef: string }> = [], warnings: string[] = [];
  let complete = true;
  const attachedCharts: ContextChart[] = [];
  async function versionValid() {
    signal.throwIfAborted(); const dataset = await prisma.marketDataset.findUnique({ where: { id: c.datasetId }, select: { dataVersion: true, historyVersion: true } });
    signal.throwIfAborted(); return dataset?.dataVersion === c.dataVersion && dataset.historyVersion === c.historyVersion;
  }
  for (let index = 0; index < seconds.length; index++) {
    const intervalSeconds = seconds[index]!;
    try {
      signal.throwIfAborted();
      const warmupCount = chartWarmupCount(c.chartPreferences);
      const budget = { rows: 25000, queries: Math.max(3000, (AI_CHART_MAX_BARS + warmupCount) * 8 + 400) };
      let plan = c.chartPlans?.find((p) => p.entryId === subject.id && p.intervalSeconds === intervalSeconds);
      if (!plan) {
        if (!await versionValid()) throw new Error("STALE_CONTEXT");
        const entry = c.entries.find((e) => e.id === subject.id); if (!entry) throw new Error("NOT_FOUND_IN_SCOPE");
        const before = await planExportWindow({ datasetId: c.datasetId, sourceSeconds: c.sourceSeconds, displaySeconds: intervalSeconds, session: c.display.session,
          anchorSequence: entry.openedSequence, endSequence: Math.min(entry.closedSequence, c.endSequence), count: 51, budget, signal });
        plan = { entryId: subject.id, intervalSeconds, fromSequence: before.fromSequence, endSequence: Math.min(entry.closedSequence, c.endSequence), historyAvailable: Math.max(0, before.count - 1) };
      }
      // A window's identity never depends on the number of requested periods.
      const variantId = hashValue([contextId, subject.id, intervalSeconds, offset, AI_CHART_MAX_BARS, c.chartPreferences, c.display, plan.endSequence, "image:3"]);
      const frozen = await prisma.aiChartVariant.findUnique({ where: { id: variantId } });
      let chart: ContextChart;
      if (frozen) chart = JSON.parse(frozen.value);
      else {
        const series = c.charts.filter((ch) => ch.entryId === subject.id && (ch.intervalSeconds ?? c.display.displayIntervalSeconds) === intervalSeconds).sort((x, y) => x.window.bars[0].firstSequence - y.window.bars[0].firstSequence);
        const captured = series.length && series[0].window.bars[0]?.firstSequence === plan.fromSequence && series.at(-1)?.window.nextSequence === null
          && series.every((ch, i) => ch.window.bars.length === AI_CHART_MAX_BARS || i === series.length - 1);
        if (captured && series[offset]) chart = series[offset];
        else {
          if (captured) { charts.push({ timeframe: normalized[index], imageStatus: "NO_MORE_IMAGES" }); continue; }
          if (!await versionValid()) throw new Error("STALE_CONTEXT");
          let anchor = plan.fromSequence, window: ContextChart["window"] | undefined;
          for (let page = 0; page <= offset; page++) {
            window = await readExportWindow({ datasetId: c.datasetId, anchorSequence: anchor, direction: "forward", count: AI_CHART_MAX_BARS, warmupCount,
              endSequence: plan.endSequence, finalSequence: plan.endSequence + 1, sourceSeconds: c.sourceSeconds, displaySeconds: intervalSeconds, session: c.display.session, signal, budget });
            if (page < offset) { if (!window.bars.length || window.nextSequence === null) { window = undefined; break; } anchor = window.nextSequence; }
          }
          if (!window?.bars.length) { charts.push({ timeframe: normalized[index], imageStatus: "NO_MORE_IMAGES" }); continue; }
          const hash = hashValue({ entryId: subject.id, displaySeconds: intervalSeconds, displaySession: c.display.displaySession, window, preferencesHash: hashValue(c.chartPreferences), rendererVersion: 1 });
          chart = { hash, sourceId: "chart:" + hash, entryId: subject.id, intervalSeconds, window, preferencesHash: hashValue(c.chartPreferences), variantRef: "variant:" + hash, sourceTimes: await chartSourceTimes(c.datasetId, window) };
          if (!await versionValid()) throw new Error("STALE_CONTEXT");
        }
        chart = annotatedChart(c, chart);
        signal.throwIfAborted(); await prisma.aiChartVariant.upsert({ where: { id: variantId }, create: { id: variantId, contextId, value: JSON.stringify(chart) }, update: {} });
      }
      const bars = chart.window.bars, more = chart.window.nextSequence !== null; complete &&= !more;
      let asset: ImageAsset | null = await prisma.aiAsset.findFirst({ where: { id: { in: allowedAssetIds }, contextId, chartHash: chart.hash }, orderBy: { createdAt: "asc" } });
      if (!asset && capture) asset = await capture(variantId, chart);
      signal.throwIfAborted();
      const value = { timeframe: normalized[index], variantRef: chart.variantRef, windowHash: chart.hash, symbol: c.symbol, timezone: c.timezone,
        ...chartImageDescription(chart),
        displaySession: c.display.displaySession, cutoffSequence: plan.endSequence, asOfTime: new Date(Date.parse(subject.closedAt) + c.sourceSeconds * 1000).toISOString(),
        actualSourceRange: [bars[0].firstSequence, bars.at(-1)!.lastSequence], actualTimeRange: [chart.sourceTimes?.[String(bars[0].firstSequence)] ?? bars[0].timestamp, chart.sourceTimes?.[String(bars.at(-1)!.lastSequence)] ?? bars.at(-1)!.timestamp],
        coverage: { visibleBars: bars.length, complete: !more, gapStatus: bars.some((b) => b.quality === "GAP" || (b.quality === undefined && b.status === "INCOMPLETE")) ? "INCOMPLETE" : bars.some((b) => b.quality === "UNKNOWN") ? "UNKNOWN" : "AS_RECORDED" },
        indicators: c.chartPreferences?.emaEnabled ? c.chartPreferences.emaIndicators.filter((i) => i.visible).map((i) => ({ name: "EMA", length: i.length })) : [],
        imageStatus: asset ? "READY" : "IMAGE_NOT_PREPARED", image: asset ? { assetRef: asset.id, bytes: asset.bytes, contentHash: asset.contentHash, origin: "BROWSER_RECONSTRUCTED" } : null };
      if (chart.annotations?.truncated) warnings.push(normalized[index] + ":TRADE_ANNOTATIONS_TRUNCATED");
      const receipt = { ...sourceReceipt(scope, chartRef(scope, subject)!, "CHART_METADATA", [normalized[index], `page:${offset}`], { ...value,
        annotationLegend: copy.ai.chartAnnotationLegend, annotationMapping: chartAnnotationMapping(c, [chart], (e) => tradeRef(scope, e)) }), variantRef: chart.variantRef, imageAttached: false };
      sources.push(receipt);
      if (asset) {
        attachedCharts.push(chart);
        const imageReceipt = { ...sourceReceipt(scope, chartRef(scope, subject)!, "CHART_IMAGE", [normalized[index], `page:${offset}`, "image"], { chartHash: chart.hash, assetId: asset.id, contentHash: asset.contentHash }), variantRef: chart.variantRef, imageAttached: true };
        sources.push(imageReceipt); images.push({ assetId: asset.id, sourceRef: imageReceipt.sourceRef });
      } else warnings.push(normalized[index] + ":IMAGE_NOT_PREPARED");
      charts.push(value);
    } catch (error) {
      signal.throwIfAborted();
      const known = error instanceof Error ? error.message : "CHART_CAPTURE_FAILED";
      const code = known === "EXPORT_WINDOW_BUDGET" ? "CHART_READ_BUDGET" : ["STALE_CONTEXT", "NOT_FOUND_IN_SCOPE"].includes(known) ? known
        : error && typeof error === "object" && "code" in error ? String(error.code) : "CHART_CAPTURE_FAILED";
      charts.push({ timeframe: normalized[index], imageStatus: "FAILED", error: code }); warnings.push(normalized[index] + ":" + code);
    }
  }
  if (!images.length && charts.some((chart) => chart.imageStatus !== "NO_MORE_IMAGES")) {
    const code = String(charts.find((chart) => chart.error)?.error ?? "IMAGE_NOT_PREPARED");
    return { result: { ...toolFailure(scope, code), warnings }, images };
  }
  const imagesComplete = charts.every((chart) => chart.imageStatus === "READY" || chart.imageStatus === "NO_MORE_IMAGES");
  const annotationsComplete = attachedCharts.every((chart) => !chart.annotations?.truncated);
  return { result: toolSuccess(scope, { charts, normalizedTimeframes: normalized, format: "IMAGES_ONLY", annotationLegend: copy.ai.chartAnnotationLegend,
    annotationMapping: chartAnnotationMapping(c, attachedCharts, (e) => tradeRef(scope, e)),
    subject: { kind: c.currentChart?.id === subject.id ? "CURRENT_CHART" : "TRADE", chartRef: chartRef(scope, subject), tradeRef: c.entries.some((e) => e.id === subject.id) ? tradeRef(scope, c.entries.find((e) => e.id === subject.id)!) : null } }, sources,
    { complete: complete && imagesComplete && annotationsComplete, imagesComplete, annotationsComplete, returnedImages: images.length }, complete ? null : encodeCursor(scope, binding, offset + 1), warnings), images };
}
