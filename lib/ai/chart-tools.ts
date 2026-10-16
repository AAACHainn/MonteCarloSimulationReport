import { z } from "zod";
import { prisma } from "@/lib/db";
import { readExportWindow } from "@/lib/market-replay/export-window";
import { formatInterval, parseSourceInterval } from "@/lib/market-replay/types";
import { hashValue, chartSourceTimes, type ContextChart, type ContextEntry } from "./context";
import { decodeCursor, encodeCursor, resourceRef, sourceReceipt, toolFailure, toolSuccess, type Receipt, type ToolEnvelope, type ToolScope } from "./tools";
export const chartArguments = z.object({ chartRef: z.string().min(1).max(160), timeframes: z.array(z.string().max(20)).min(1).max(4), cursor: z.string().max(2000).nullable(), limit: z.number().int().min(1).max(200).nullable(), includeImage: z.boolean() }).strict();
export const chartRef = (scope: ToolScope, e: ContextEntry) => scope.context.chartPlans?.some((p) => p.entryId === e.id) ? resourceRef(scope, "chart-context", e.logicalKey) : null;
export const chartDirectory = (scope: ToolScope, e: ContextEntry) => ({ chartRef: chartRef(scope, e), sourceIntervalSeconds: scope.context.sourceSeconds, originalTimeframe: formatInterval(e.displayIntervalSeconds),
  availableTimeframes: scope.context.chartPlans?.filter((p) => p.entryId === e.id).map((p) => formatInterval(p.intervalSeconds)) ?? [],
  boundaries: scope.context.chartPlans?.filter((p) => p.entryId === e.id).map((p) => ({ timeframe: formatInterval(p.intervalSeconds), fromSequence: p.fromSequence, endSequence: p.endSequence })) ?? [] });
export async function executeChartTool(scope: ToolScope, contextId: string, raw: unknown, signal: AbortSignal, allowedAssetIds: string[]): Promise<{ result: ToolEnvelope; images: Array<{ assetId: string; sourceRef: string }> }> {
  const fail = (code: string) => ({ result: toolFailure(scope, code), images: [] });
  const parsed = chartArguments.safeParse(raw); if (!parsed.success) return fail("INVALID_ARGUMENTS");
  const a = parsed.data, c = scope.context, e = c.entries.find((entry) => chartRef(scope, entry) === a.chartRef);
  if (!e) return fail("NOT_FOUND_IN_SCOPE");
  const seconds = [...new Set(a.timeframes.map(parseSourceInterval))];
  const plans = seconds.map((s) => c.chartPlans?.find((p) => p.entryId === e.id && p.intervalSeconds === s));
  if (plans.some((p) => !p)) return fail("UNSUPPORTED_TIMEFRAME");
  const binding = ["get_chart_context", a.chartRef, seconds, a.includeImage, a.limit], offset = decodeCursor(scope, binding, a.cursor);
  if (offset === null) return fail("INVALID_CURSOR");
  const normalized = seconds.map((s) => formatInterval(s!));
  let count = Math.floor(Math.min(a.limit ?? 120, 80) / seconds.length);
  if (!count) return fail("INVALID_ARGUMENTS");
  const budget = { rows: 25000, queries: 3000 };
  // Cursor offset indexes canonical slices, bound to page size; no live rows are used for existing variants.
  async function versionValid() {
    signal.throwIfAborted();
    const dataset = await prisma.marketDataset.findUnique({ where: { id: c.datasetId }, select: { dataVersion: true, historyVersion: true } });
    signal.throwIfAborted(); return dataset?.dataVersion === c.dataVersion && dataset.historyVersion === c.historyVersion;
  }
  const charts: Record<string, unknown>[] = [], sources: Receipt[] = [], images: Array<{ assetId: string; sourceRef: string }> = [], warnings: string[] = [];
  let complete = true;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!, intervalSeconds = plan.intervalSeconds;
    const pageSize = count;
    const variantId = hashValue([contextId, e.id, intervalSeconds, offset, pageSize, c.chartPreferences, c.display, c.endSequence, "renderer:1"]);
    signal.throwIfAborted();
    const frozen = await prisma.aiChartVariant.findUnique({ where: { id: variantId } });
    let chart: ContextChart;
    if (frozen) chart = JSON.parse(frozen.value);
    else {
      const capturedSeries = c.charts.filter((ch) => ch.entryId === e.id && (ch.intervalSeconds ?? c.display.displayIntervalSeconds) === intervalSeconds).sort((a, b) => a.window.bars[0].firstSequence - b.window.bars[0].firstSequence);
      const allCapturedBars = capturedSeries.flatMap((ch) => ch.window.bars);
      const canReadCaptured = Boolean(capturedSeries.length && capturedSeries[0].window.bars[0]?.firstSequence === plan.fromSequence && capturedSeries.at(-1)?.window.nextSequence === null);
      if (!canReadCaptured && !await versionValid()) return fail("STALE_CONTEXT");
      let anchor = plan.fromSequence;
      let window: ContextChart["window"] | undefined;
      // Bounded scan of prior slices, preserving complete bars and exact source progression.
      if (offset > 100) return fail("INVALID_CURSOR");
      if (canReadCaptured) {
        const bars = allCapturedBars.slice(offset * pageSize, (offset + 1) * pageSize);
        const warmupCount = c.chartPreferences?.emaEnabled ? Math.min(1000, Math.max(0, ...c.chartPreferences.emaIndicators.map((ema) => ema.length * 3))) : 0;
        window = { bars, warmupBars: warmupCount ? [...capturedSeries[0].window.warmupBars, ...allCapturedBars.slice(0, offset * pageSize)].slice(-warmupCount) : [], previousSequence: bars[0]?.firstSequence > 0 ? bars[0].firstSequence - 1 : null,
          nextSequence: (offset + 1) * pageSize < allCapturedBars.length ? bars.at(-1)!.lastSequence + 1 : null };
      }
      else {
        for (let page = 0; page <= offset; page++) {
        const original = c.charts.find((ch) => ch.entryId === e.id && (ch.intervalSeconds ?? c.display.displayIntervalSeconds) === intervalSeconds && ch.window.bars[0]?.firstSequence === anchor
          && (ch.window.bars.length === pageSize || (ch.window.bars.length < pageSize && ch.window.bars.at(-1)?.lastSequence === plan.endSequence)));
        window = original?.window ?? await readExportWindow({ datasetId: c.datasetId, anchorSequence: anchor, direction: "forward", count: pageSize,
          warmupCount: c.chartPreferences?.emaEnabled ? Math.min(1000, Math.max(0, ...c.chartPreferences.emaIndicators.map((ema) => ema.length * 3))) : 0,
          endSequence: plan.endSequence, finalSequence: plan.endSequence + 1, sourceSeconds: c.sourceSeconds, displaySeconds: intervalSeconds, session: c.display.session, signal, budget });
        if (page < offset) { if (!window.bars.length || window.nextSequence === null) { window = { ...window, bars: [], nextSequence: null }; break; } anchor = window.nextSequence; }
        }
      }
      if (!window) return fail("INVALID_CURSOR");
      const sourceTimes = canReadCaptured ? Object.assign({}, ...capturedSeries.map((ch) => ch.sourceTimes ?? {})) : await chartSourceTimes(c.datasetId, window);
      if (!canReadCaptured && !await versionValid()) return fail("STALE_CONTEXT");
      const preferencesHash = hashValue(c.chartPreferences);
      const hash = hashValue({ entryId: e.id, displaySeconds: intervalSeconds, displaySession: c.display.displaySession, window, preferencesHash, rendererVersion: 1 });
      const initial = c.charts.find((ch) => ch.entryId === e.id && ch.intervalSeconds === intervalSeconds && hashValue(ch.window) === hashValue(window));
      chart = initial ?? { hash, sourceId: "chart:" + hash, entryId: e.id, window, intervalSeconds, preferencesHash, variantRef: "variant:" + hash, sourceTimes };
      signal.throwIfAborted();
      await prisma.aiChartVariant.upsert({ where: { id: variantId }, create: { id: variantId, contextId, value: JSON.stringify(chart) }, update: {} });
      signal.throwIfAborted();
    }
    const bars = chart.window.bars, more = chart.window.nextSequence !== null && Boolean(bars.length);
    complete &&= !more;
    const asset = a.includeImage ? await prisma.aiAsset.findFirst({ where: { id: { in: allowedAssetIds }, contextId, chartHash: chart.hash }, orderBy: { createdAt: "asc" } }) : null;
    signal.throwIfAborted();
    const value = { timeframe: normalized[i], intervalSeconds, variantRef: chart.variantRef, windowHash: chart.hash, bars, barStatus: bars.map((b) => b.status),
      actualSourceRange: bars.length ? [bars[0].firstSequence, bars.at(-1)!.lastSequence] : null,
      actualTimeRange: bars.length && chart.sourceTimes?.[String(bars[0].firstSequence)] && chart.sourceTimes?.[String(bars.at(-1)!.lastSequence)] ? [chart.sourceTimes[String(bars[0].firstSequence)], chart.sourceTimes[String(bars.at(-1)!.lastSequence)]] : null,
      bucketTimeRange: bars.length ? [bars[0].timestamp, bars.at(-1)!.bucketEnd] : null,
      asOfTime: new Date(Date.parse(e.closedAt) + c.sourceSeconds * 1000).toISOString(), cutoffSequence: plan.endSequence,
      coverage: { returnedBars: bars.length, historyAvailable: plan.historyAvailable, complete: !more, gapStatus: bars.some((b) => b.status === "INCOMPLETE") ? "INCOMPLETE" : "AS_RECORDED" },
      imageStatus: !a.includeImage ? "NOT_REQUESTED" : asset ? "READY" : "IMAGE_NOT_PREPARED", image: asset ? { assetRef: asset.id, contentHash: asset.contentHash, bytes: asset.bytes, origin: "BROWSER_RECONSTRUCTED" } : null };
    const receipt = { ...sourceReceipt(scope, a.chartRef, "CHART_DATA", [normalized[i], `page:${offset}`], value), variantRef: chart.variantRef, imageAttached: false };
    sources.push(receipt);
    if (asset) {
      const imageReceipt = { ...sourceReceipt(scope, a.chartRef, "CHART_IMAGE", [normalized[i], `page:${offset}`, "image"], { chartHash: chart.hash, assetId: asset.id, contentHash: asset.contentHash, bytes: asset.bytes }), variantRef: chart.variantRef, imageAttached: true };
      sources.push(imageReceipt); images.push({ assetId: asset.id, sourceRef: imageReceipt.sourceRef });
    } else if (a.includeImage) warnings.push(normalized[i] + ":IMAGE_NOT_PREPARED");
    if (plan.historyAvailable < 50) warnings.push(normalized[i] + ":INSUFFICIENT_BACKGROUND_HISTORY");
    charts.push(value);
  }
  count = charts.reduce((n, ch) => n + (ch.bars as unknown[]).length, 0);
  const result = toolSuccess(scope, { charts, normalizedTimeframes: normalized }, sources, { returnedBars: count, selectionComplete: complete, dataComplete: complete, complete: complete && (!a.includeImage || images.length === charts.length), imagesComplete: !a.includeImage || images.length === charts.length },
    complete ? null : encodeCursor(scope, binding, offset + 1), warnings);
  if (Buffer.byteLength(JSON.stringify(result)) > 32768) return fail("RESULT_TOO_LARGE");
  return { result, images };
}
