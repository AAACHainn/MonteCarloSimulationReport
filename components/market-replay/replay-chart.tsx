"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode,
  HistogramSeries, LineSeries, type IChartApi, type IPriceLine, type ISeriesApi,
  type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { calculateEmaSeries } from "@/lib/market-replay/ema";
import type { AggregatedMarketBarData, EmaIndicatorConfig } from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
import { rangeAfterNewReplayBar } from "@/lib/market-replay/chart-range";
import type { PaperOrderData, PaperSessionSnapshot } from "@/lib/paper-trading/types";

function chartTime(timestamp: string) {
  return Math.floor(new Date(timestamp).getTime() / 1_000) as UTCTimestamp;
}

function candle(bar: AggregatedMarketBarData) {
  const incomplete = bar.status === "INCOMPLETE";
  return {
    time: chartTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    ...(incomplete ? { borderColor: "#f59e0b", wickColor: "#f59e0b" } : {}),
  };
}

function volume(bar: AggregatedMarketBarData) {
  return {
    time: chartTime(bar.timestamp), value: bar.volume ?? 0,
    color: bar.status === "INCOMPLETE" ? "rgba(245,158,11,.5)" : bar.close >= bar.open ? "rgba(22,163,74,.45)" : "rgba(220,38,38,.45)",
  };
}

export function ReplayChart({
  bars, warmupBars, timezone, emaEnabled, emaIndicators, paperSnapshot,
  onOrderPriceChange, onTradingInteraction,
}: {
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  timezone: string;
  emaEnabled: boolean;
  emaIndicators: EmaIndicatorConfig[];
  paperSnapshot: PaperSessionSnapshot | null;
  onOrderPriceChange: (orderId: string, update: { price?: number; quantity?: number }) => Promise<void>;
  onTradingInteraction: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef(new Map<string, IPriceLine>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const emaSeriesRef = useRef(new Map<string, ISeriesApi<"Line">>());
  const lastDataRef = useRef<AggregatedMarketBarData[]>([]);
  const hasVolume = useMemo(() => [...warmupBars, ...bars].some((bar) => bar.volume !== null), [bars, warmupBars]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const priceLines = priceLinesRef.current;
    const emaSeries = emaSeriesRef.current;
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    const chart = createChart(container, {
      width: container.clientWidth, height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "#fff" }, textColor: "#475569", attributionLogo: true, panes: { separatorColor: "#e2e8f0", separatorHoverColor: "#cbd5e1" } },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "zh-CN", timeFormatter: (time: Time) => typeof time === "number" ? formatter.format(new Date(time * 1_000)) : String(time) },
      timeScale: { timeVisible: true, secondsVisible: true, rightOffset: 4, shiftVisibleRangeOnNewBar: false },
      rightPriceScale: { borderColor: "#e2e8f0" },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626", wickUpColor: "#16a34a", wickDownColor: "#dc2626", borderVisible: true,
    });
    let volumes: ISeriesApi<"Histogram"> | null = null;
    if (hasVolume) {
      const pane = chart.addPane();
      chart.panes()[0]?.setStretchFactor(4); pane.setStretchFactor(1);
      volumes = pane.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width && entry.contentRect.height) chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container);
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = volumes;
    markersRef.current = createSeriesMarkers(candles, []);
    return () => {
      observer.disconnect(); chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      markersRef.current = null; priceLines.clear(); emaSeries.clear(); lastDataRef.current = [];
    };
  }, [hasVolume, timezone]);

  useEffect(() => {
    const chart = chartRef.current; const series = candleRef.current;
    if (!chart || !series) return;
    const previous = lastDataRef.current;
    const next = bars;
    const samePrefix = previous.length > 0 && next.length >= previous.length
      && previous.slice(0, -1).every((bar, index) => bar.timestamp === next[index]?.timestamp);
    if (samePrefix && next.length <= previous.length + 1) {
      const range = chart.timeScale().getVisibleLogicalRange();
      const previousLastIndex = previous.length - 1;
      for (const bar of next.slice(Math.max(0, previous.length - 1))) {
        series.update(candle(bar)); if (bar.volume !== null) volumeRef.current?.update(volume(bar));
      }
      if (range && next.length > previous.length) chart.timeScale().setVisibleLogicalRange(rangeAfterNewReplayBar(range, previousLastIndex));
    } else {
      const hadData = previous.length > 0;
      series.setData(next.map(candle));
      volumeRef.current?.setData(next.filter((bar) => bar.volume !== null).map(volume));
      if (!hadData || previous[0]?.timestamp !== next[0]?.timestamp) chart.timeScale().fitContent();
    }
    lastDataRef.current = next.map((bar) => ({ ...bar }));
  }, [bars]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const active = emaEnabled ? emaIndicators.filter((item) => item.visible) : [];
    const activeIds = new Set(active.map((item) => item.id));
    for (const [id, series] of emaSeriesRef.current) {
      if (!activeIds.has(id)) { chart.removeSeries(series); emaSeriesRef.current.delete(id); }
    }
    const all = [...warmupBars, ...bars];
    for (const indicator of active) {
      let series = emaSeriesRef.current.get(indicator.id);
      if (!series) {
        series = chart.addSeries(LineSeries, { color: indicator.color, title: copy.marketReplay.emaLine(indicator.length), lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false });
        emaSeriesRef.current.set(indicator.id, series);
      }
      series.applyOptions({ color: indicator.color, title: copy.marketReplay.emaLine(indicator.length) });
      const result = calculateEmaSeries(all, indicator.length, all.length - 1, warmupBars.length);
      series.setData(result.points.map((point) => ({ time: chartTime(all[point.sequence].timestamp), value: point.value })));
    }
  }, [bars, emaEnabled, emaIndicators, warmupBars]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current.values()) series.removePriceLine(line);
    priceLinesRef.current.clear();
    if (!paperSnapshot) { markersRef.current?.setMarkers([]); return; }
    if (paperSnapshot.session.averageEntryPrice !== null && paperSnapshot.session.netQuantity !== 0) {
      priceLinesRef.current.set("position", series.createPriceLine({ price: paperSnapshot.session.averageEntryPrice, color: "#475569", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: copy.paperTrading.positionValue(paperSnapshot.session.netQuantity, paperSnapshot.session.averageEntryPrice) }));
    }
    for (const order of paperSnapshot.activeOrders) {
      if (order.price === null) continue;
      const isStop = order.isProtective && order.type === "STOP";
      const color = isStop ? "#dc2626" : order.isProtective ? "#16a34a" : order.side === "BUY" ? "#2563eb" : "#ea580c";
      const title = order.isProtective ? isStop ? copy.paperTrading.stopLoss : copy.paperTrading.takeProfit : `${order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell} ${order.type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop}`;
      priceLinesRef.current.set(order.id, series.createPriceLine({ price: order.price, color, lineWidth: 2, lineStyle: order.isProtective ? 0 : 2, axisLabelVisible: true, title }));
    }
    markersRef.current?.setMarkers(paperSnapshot.recentFills.flatMap((fill) => {
      const aggregate = bars.find((bar) => fill.sequence >= bar.firstSequence && fill.sequence <= bar.lastSequence);
      if (!aggregate) return [];
      return [{ time: chartTime(aggregate.timestamp), position: fill.side === "BUY" ? "belowBar" as const : "aboveBar" as const, shape: fill.side === "BUY" ? "arrowUp" as const : "arrowDown" as const, color: fill.side === "BUY" ? "#16a34a" : "#dc2626", text: fill.reason }];
    }));
  }, [bars, paperSnapshot]);

  useEffect(() => {
    const container = containerRef.current; const series = candleRef.current;
    if (!container || !series || !paperSnapshot) return;
    let dragging: { order: PaperOrderData; originalPrice: number; previewPrice: number } | null = null;
    const down = (event: PointerEvent) => {
      const y = event.clientY - container.getBoundingClientRect().top;
      const candidate = paperSnapshot.activeOrders.flatMap((order) => order.price === null ? [] : [{ order, coordinate: series.priceToCoordinate(order.price) }])
        .filter((item) => item.coordinate !== null).sort((a, b) => Math.abs(Number(a.coordinate) - y) - Math.abs(Number(b.coordinate) - y))[0];
      if (!candidate || candidate.order.price === null || Math.abs(Number(candidate.coordinate) - y) > 8) return;
      event.preventDefault(); onTradingInteraction(); dragging = { order: candidate.order, originalPrice: candidate.order.price, previewPrice: candidate.order.price }; container.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return; const price = series.coordinateToPrice((event.clientY - container.getBoundingClientRect().top) as never);
      if (price === null || !Number.isFinite(Number(price))) return; dragging.previewPrice = Number(price); priceLinesRef.current.get(dragging.order.id)?.applyOptions({ price: dragging.previewPrice });
    };
    const finish = () => { if (!dragging) return; const value = dragging; dragging = null; if (value.previewPrice !== value.originalPrice) void onOrderPriceChange(value.order.id, { price: value.previewPrice }); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && dragging) { priceLinesRef.current.get(dragging.order.id)?.applyOptions({ price: dragging.originalPrice }); dragging = null; } };
    container.addEventListener("pointerdown", down); container.addEventListener("pointermove", move); container.addEventListener("pointerup", finish); window.addEventListener("keydown", key);
    return () => { container.removeEventListener("pointerdown", down); container.removeEventListener("pointermove", move); container.removeEventListener("pointerup", finish); window.removeEventListener("keydown", key); };
  }, [onOrderPriceChange, onTradingInteraction, paperSnapshot]);

  const latest = bars.at(-1);
  return (
    <div className="relative">
      <div ref={containerRef} className="h-[calc(100vh-18rem)] min-h-[620px] w-full overflow-hidden rounded-lg border bg-white" aria-label={copy.marketReplay.chartAriaLabel} />
      {latest?.status !== "COMPLETE" ? (
        <div className={`pointer-events-none absolute left-3 top-3 rounded-md px-2 py-1 text-xs shadow-sm ${latest?.status === "INCOMPLETE" ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-800"}`}>
          {latest?.status === "INCOMPLETE" ? copy.marketReplay.incompleteBar(latest.sourceCount, latest.expectedCount) : latest ? copy.marketReplay.formingBar(latest.sourceCount, latest.expectedCount) : null}
        </div>
      ) : null}
    </div>
  );
}
