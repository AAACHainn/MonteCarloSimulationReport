import { CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, LineSeries, type UTCTimestamp, type Time, type TickMarkType } from "lightweight-charts";
import { candlestickSeriesStyleOptions } from "@/lib/market-replay/candlestick-style";
import { calculateEmaSeries } from "@/lib/market-replay/ema";
import { emaSeriesStyleOptions } from "@/lib/market-replay/ema-style";
import { ReplayTradeAnnotationPrimitive, buildReplayTradePriceAnnotations } from "@/lib/market-replay/trade-annotation-primitive";
import { formatChartTick, chartCandleData, chartVolumeData } from "@/lib/market-replay/chart-data";
import { BarCountPrimitive } from "@/lib/market-replay/bar-count-primitive";
import type { TradingSessionConfig } from "@/lib/market-replay/types";
import { priceDecimalsForTick } from "@/lib/market-replay/price-ticks";
import { copy } from "@/lib/i18n";
import type { PdfChartPreferences, PdfChartPage, PdfOptions, PdfWindow } from "./pdf-types";
import type { ReplayJournalEntryData, ReplayTradeAnnotationData } from "./types";

function aborted() { return new DOMException("Aborted", "AbortError"); }
export function waitForVisible(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { document.removeEventListener("visibilitychange", change); signal.removeEventListener("abort", abort); };
    const change = () => { if (!document.hidden) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(aborted()); };
    document.addEventListener("visibilitychange", change); signal.addEventListener("abort", abort, { once: true });
  });
}
async function frame(signal: AbortSignal) {
  await waitForVisible(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => { cancelAnimationFrame(id); reject(aborted()); };
    const id = requestAnimationFrame(() => { signal.removeEventListener("abort", abort); resolve(); });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
const chartTime = (timestamp: string) => Math.floor(new Date(timestamp).getTime() / 1000) as UTCTimestamp;
export function createPdfChartRenderer(
  container: HTMLElement,
  preferences: PdfChartPreferences,
  tick: number,
  display: Pick<PdfOptions, "displaySession" | "displayIntervalSeconds"> & { session: TradingSessionConfig },
) {
  const chart = createChart(container, {
    width: 2400, height: 1200, autoSize: false,
    layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#475569", fontSize: 28, attributionLogo: true },
    grid: { vertLines: { visible: preferences.gridVisible, color: "#f1f5f9" }, horzLines: { visible: preferences.gridVisible, color: "#f1f5f9" } },
    crosshair: { mode: CrosshairMode.Hidden }, handleScale: false, handleScroll: false,
    timeScale: { timeVisible: true, secondsVisible: true, rightOffset: 0, tickMarkMaxCharacterLength: 8, tickMarkFormatter: (time: Time, type: TickMarkType) => formatChartTick(time, type, preferences.displayUtcOffsetMinutes) },
    localization: { locale: "zh-CN" },
    rightPriceScale: { scaleMargins: { top: 0.12, bottom: preferences.volumeVisible ? 0.24 : 0.12 } },
  });
  let priceMin = 0; let priceMax = 1;
  const candles = chart.addSeries(CandlestickSeries, {
    ...candlestickSeriesStyleOptions(preferences.candlestickStyle),
    priceLineVisible: false, lastValueVisible: false,
    priceFormat: { type: "price", minMove: tick, precision: priceDecimalsForTick(tick) },
    autoscaleInfoProvider: () => ({ priceRange: { minValue: priceMin, maxValue: priceMax } }),
  });
  const barCount = new BarCountPrimitive(28 / 10);
  candles.attachPrimitive(barCount);
  const primitive = new ReplayTradeAnnotationPrimitive(28 / 12);
  candles.attachPrimitive(primitive);
  const volume = preferences.volumeVisible ? chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }) : null;
  volume?.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
  const ema = preferences.emaEnabled ? preferences.emaIndicators.filter((i) => i.visible).map((indicator) => ({
    indicator, series: chart.addSeries(LineSeries, { ...emaSeriesStyleOptions(indicator), lineWidth: Math.min(4, indicator.lineWidth + 1) as 2 | 3 | 4, priceLineVisible: false, lastValueVisible: false }),
  })) : [];
  return {
    async capture(window: PdfWindow, page: PdfChartPage, entries: ReplayJournalEntryData[], signal: AbortSignal) {
      signal.throwIfAborted();
      const bars = window.bars.filter((b) => b.lastSequence <= page.toSequence);
      if (bars.length !== page.count || bars[0]?.firstSequence !== page.fromSequence || bars.at(-1)?.lastSequence !== page.toSequence)
        throw new Error(copy.paperTrading.pdf.missingBars);
      const annotations: ReplayTradeAnnotationData[] = entries.filter((e) => page.entryIds.includes(e.id)).map((e) => ({
        id: e.id, no: e.no, direction: e.direction, entryOrderType: e.entryOrderType, openedSequence: e.openedSequence, closedSequence: e.closedSequence,
        entryPrice: e.entryPrice, initialStopPrice: e.initialStopPrice, actualRisk: e.actualRisk, exitPrice: e.exitPrice, result: e.result,
      }));
      const bounds = bars.flatMap((b) => [b.low, b.high]);
      for (const entry of annotations) for (const a of buildReplayTradePriceAnnotations(entry))
        if (bars.some((b) => a.sequence >= b.firstSequence && a.sequence <= b.lastSequence)) bounds.push(a.price);
      const all = [...window.warmupBars, ...bars];
      for (const { indicator, series } of ema) {
        const values = calculateEmaSeries(all, indicator.length, all.length - 1).points.filter((p) => p.sequence >= window.warmupBars.length);
        bounds.push(...values.map((p) => p.value));
        series.setData(values.map((p) => ({ time: chartTime(all[p.sequence].timestamp), value: p.value })));
      }
      priceMin = Math.min(...bounds); priceMax = Math.max(...bounds);
      if (priceMax <= priceMin) { priceMin -= tick; priceMax += tick; }
      candles.setData(bars.map(chartCandleData));
      volume?.setData(bars.filter((b) => b.volume !== null).map((b) => chartVolumeData(b, preferences.candlestickStyle.upColor + "55", preferences.candlestickStyle.downColor + "55")));
      barCount.setData({ bars, ...display, config: preferences.barCountConfig });
      primitive.setData({ bars, entries: annotations });
      chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: bars.length + Math.max(3, Math.ceil(bars.length * 0.04)) });
      chart.priceScale("right").applyOptions({ autoScale: true });
      await document.fonts.ready;
      await frame(signal); await frame(signal);
      const source = chart.takeScreenshot(true, false);
      const output = document.createElement("canvas"); output.width = 2400; output.height = 1200;
      const context = output.getContext("2d")!;
      context.fillStyle = "#fff"; context.fillRect(0, 0, 2400, 1200); context.drawImage(source, 0, 0, 2400, 1200);
      try {
        const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error(copy.paperTrading.pdf.failed)), "image/png"));
        signal.throwIfAborted();
        return { png: await blob.arrayBuffer(), caption: bars.some((b) => b.status !== "COMPLETE") ? copy.paperTrading.pdf.incomplete : copy.paperTrading.pdf.chartLegend };
      } finally { source.width = 0; source.height = 0; output.width = 0; output.height = 0; }
    },
    remove() { chart.remove(); },
  };
}
