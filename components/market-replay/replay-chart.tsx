"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { calculateEmaSeries, nextEma } from "@/lib/market-replay/ema";
import type { EmaIndicatorConfig, MarketBarData } from "@/lib/market-replay/types";
import { REPLAY_HISTORY_BARS } from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
import { rangeAfterNewReplayBar } from "@/lib/market-replay/chart-range";
import type { PaperOrderData, PaperSessionSnapshot } from "@/lib/paper-trading/types";

function chartTime(timestamp: string) {
  return Math.floor(new Date(timestamp).getTime() / 1_000) as UTCTimestamp;
}

function candle(bar: MarketBarData) {
  return { time: chartTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close };
}

function volume(bar: MarketBarData) {
  return {
    time: chartTime(bar.timestamp),
    value: bar.volume ?? 0,
    color: bar.close >= bar.open ? "rgba(22, 163, 74, 0.45)" : "rgba(220, 38, 38, 0.45)",
  };
}

export function ReplayChart({
  bars,
  startSequence,
  currentSequence,
  timezone,
  emaEnabled,
  emaIndicators,
  paperSnapshot,
  onOrderPriceChange,
  onTradingInteraction,
}: {
  bars: MarketBarData[];
  startSequence: number;
  currentSequence: number;
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
  const emaSeriesRef = useRef(new Map<string, {
    series: ISeriesApi<"Line">;
    length: number;
    lastSequence: number;
    lastValue: number | null;
  }>());
  const lastSequenceRef = useRef(currentSequence);
  const initialSequenceRef = useRef(currentSequence);
  const hasVolume = useMemo(() => bars.some((bar) => bar.volume !== null), [bars]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const emaSeries = emaSeriesRef.current;
    const priceLines = priceLinesRef.current;
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#475569",
        attributionLogo: true,
        panes: { separatorColor: "#e2e8f0", separatorHoverColor: "#cbd5e1" },
      },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: "zh-CN",
        timeFormatter: (time: Time) => typeof time === "number" ? formatter.format(new Date(time * 1_000)) : String(time),
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        shiftVisibleRangeOnNewBar: false,
      },
      rightPriceScale: { borderColor: "#e2e8f0" },
    });
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderVisible: false,
    });
    let volumeSeries: ISeriesApi<"Histogram"> | null = null;
    if (hasVolume) {
      const volumePane = chart.addPane();
      chart.panes()[0]?.setStretchFactor(4);
      volumePane.setStretchFactor(1);
      volumeSeries = volumePane.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }

    const initialTo = initialSequenceRef.current;
    const initialFrom = Math.max(0, startSequence - REPLAY_HISTORY_BARS);
    const initialBars = initialTo >= initialFrom ? bars.slice(initialFrom, initialTo + 1) : [];
    candlestickSeries.setData(initialBars.map(candle));
    volumeSeries?.setData(initialBars.filter((bar) => bar.volume !== null).map(volume));
    chart.timeScale().fitContent();

    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (size?.width && size.height) chart.applyOptions({ width: size.width, height: size.height });
    });
    observer.observe(container);

    chartRef.current = chart;
    candleRef.current = candlestickSeries;
    volumeRef.current = volumeSeries;
    markersRef.current = createSeriesMarkers(candlestickSeries, []);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      priceLines.clear();
      emaSeries.clear();
    };
  }, [bars, hasVolume, startSequence, timezone]);

  useEffect(() => {
    const chart = chartRef.current;
    const candlestickSeries = candleRef.current;
    if (!chart || !candlestickSeries || currentSequence === lastSequenceRef.current) return;

    if (currentSequence === lastSequenceRef.current + 1) {
      const next = bars[currentSequence];
      if (next) {
        const visibleRange = chart.timeScale().getVisibleLogicalRange();
        const firstLoadedSequence = Math.max(0, startSequence - REPLAY_HISTORY_BARS);
        const previousLastLogicalIndex = lastSequenceRef.current - firstLoadedSequence;
        candlestickSeries.update(candle(next));
        if (next.volume !== null) volumeRef.current?.update(volume(next));
        if (visibleRange) {
          chart.timeScale().setVisibleLogicalRange(
            rangeAfterNewReplayBar(visibleRange, previousLastLogicalIndex),
          );
        }
      }
    } else {
      const from = Math.max(0, startSequence - REPLAY_HISTORY_BARS);
      const visibleBars = currentSequence >= from ? bars.slice(from, currentSequence + 1) : [];
      candlestickSeries.setData(visibleBars.map(candle));
      volumeRef.current?.setData(visibleBars.filter((bar) => bar.volume !== null).map(volume));
      chart.timeScale().fitContent();
    }
    lastSequenceRef.current = currentSequence;
  }, [bars, currentSequence, startSequence]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const activeIndicators = emaEnabled ? emaIndicators.filter((indicator) => indicator.visible) : [];
    const activeIds = new Set(activeIndicators.map((indicator) => indicator.id));
    for (const [id, runtime] of emaSeriesRef.current) {
      const config = activeIndicators.find((indicator) => indicator.id === id);
      if (!activeIds.has(id) || config?.length !== runtime.length) {
        chart.removeSeries(runtime.series);
        emaSeriesRef.current.delete(id);
      }
    }

    const displayFrom = Math.max(0, startSequence - REPLAY_HISTORY_BARS);
    for (const indicator of activeIndicators) {
      let runtime = emaSeriesRef.current.get(indicator.id);
      if (!runtime) {
        const series = chart.addSeries(LineSeries, {
          color: indicator.color,
          title: copy.marketReplay.emaLine(indicator.length),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        runtime = { series, length: indicator.length, lastSequence: Number.NaN, lastValue: null };
        emaSeriesRef.current.set(indicator.id, runtime);
      } else {
        runtime.series.applyOptions({ color: indicator.color, title: copy.marketReplay.emaLine(indicator.length) });
      }

      if (runtime.lastSequence === currentSequence) continue;
      if (currentSequence === runtime.lastSequence + 1) {
        const nextBar = bars[currentSequence];
        if (nextBar && currentSequence >= indicator.length - 1) {
          if (runtime.lastValue === null) {
            runtime.lastValue = calculateEmaSeries(
              bars,
              indicator.length,
              currentSequence,
              currentSequence,
            ).lastValue;
          } else {
            runtime.lastValue = nextEma(runtime.lastValue, nextBar.close, indicator.length);
          }
          if (runtime.lastValue !== null && currentSequence >= displayFrom) {
            runtime.series.update({ time: chartTime(nextBar.timestamp), value: runtime.lastValue });
          }
        }
        runtime.lastSequence = currentSequence;
        continue;
      }

      const result = calculateEmaSeries(bars, indicator.length, currentSequence, displayFrom);
      runtime.series.setData(result.points.map((point) => ({
        time: chartTime(bars[point.sequence].timestamp),
        value: point.value,
      })));
      runtime.lastValue = result.lastValue;
      runtime.lastSequence = currentSequence;
    }
  }, [bars, currentSequence, emaEnabled, emaIndicators, startSequence]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current.values()) series.removePriceLine(line);
    priceLinesRef.current.clear();
    if (!paperSnapshot) {
      markersRef.current?.setMarkers([]);
      return;
    }

    if (paperSnapshot.session.averageEntryPrice !== null && paperSnapshot.session.netQuantity !== 0) {
      const line = series.createPriceLine({
        price: paperSnapshot.session.averageEntryPrice,
        color: "#475569",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: copy.paperTrading.positionValue(
          paperSnapshot.session.netQuantity,
          paperSnapshot.session.averageEntryPrice,
        ),
      });
      priceLinesRef.current.set("position", line);
    }
    for (const order of paperSnapshot.activeOrders) {
      if (order.price === null) continue;
      const isStop = order.isProtective && order.type === "STOP";
      const color = isStop ? "#dc2626" : order.isProtective ? "#16a34a" : order.side === "BUY" ? "#2563eb" : "#ea580c";
      const title = order.isProtective
        ? isStop ? copy.paperTrading.stopLoss : copy.paperTrading.takeProfit
        : `${order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell} ${order.type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop}`;
      const line = series.createPriceLine({ price: order.price, color, lineWidth: 2, lineStyle: order.isProtective ? 0 : 2, axisLabelVisible: true, title });
      priceLinesRef.current.set(order.id, line);
    }

    markersRef.current?.setMarkers([...paperSnapshot.recentFills]
      .filter((fill) => fill.sequence <= currentSequence)
      .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
      .map((fill) => ({
        time: chartTime(fill.timestamp),
        position: fill.side === "BUY" ? "belowBar" as const : "aboveBar" as const,
        shape: fill.side === "BUY" ? "arrowUp" as const : "arrowDown" as const,
        color: fill.side === "BUY" ? "#16a34a" : "#dc2626",
        text: fill.reason,
      })));
  }, [currentSequence, paperSnapshot]);

  useEffect(() => {
    const container = containerRef.current;
    const series = candleRef.current;
    if (!container || !series || !paperSnapshot) return;
    let dragging: { order: PaperOrderData; originalPrice: number; previewPrice: number } | null = null;

    const pointerDown = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const candidates = paperSnapshot.activeOrders.flatMap((order) => {
        if (order.price === null) return [];
        const coordinate = series.priceToCoordinate(order.price);
        return coordinate === null ? [] : [{ order, distance: Math.abs(coordinate - y) }];
      }).sort((a, b) => a.distance - b.distance);
      const candidate = candidates[0];
      if (!candidate || candidate.distance > 8 || candidate.order.price === null) return;
      event.preventDefault();
      onTradingInteraction();
      dragging = { order: candidate.order, originalPrice: candidate.order.price, previewPrice: candidate.order.price };
      container.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      const price = series.coordinateToPrice((event.clientY - rect.top) as never);
      if (price === null || !Number.isFinite(Number(price))) return;
      dragging.previewPrice = Number(price);
      priceLinesRef.current.get(dragging.order.id)?.applyOptions({ price: dragging.previewPrice });
    };
    const finish = () => {
      if (!dragging) return;
      const current = dragging;
      dragging = null;
      if (current.previewPrice !== current.originalPrice) void onOrderPriceChange(current.order.id, { price: current.previewPrice });
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragging) return;
      priceLinesRef.current.get(dragging.order.id)?.applyOptions({ price: dragging.originalPrice });
      dragging = null;
    };
    container.addEventListener("pointerdown", pointerDown);
    container.addEventListener("pointermove", pointerMove);
    container.addEventListener("pointerup", finish);
    window.addEventListener("keydown", keyDown);
    return () => {
      container.removeEventListener("pointerdown", pointerDown);
      container.removeEventListener("pointermove", pointerMove);
      container.removeEventListener("pointerup", finish);
      window.removeEventListener("keydown", keyDown);
    };
  }, [onOrderPriceChange, onTradingInteraction, paperSnapshot]);

  return (
    <div
      ref={containerRef}
      className="h-[calc(100vh-21rem)] min-h-[600px] w-full overflow-hidden rounded-lg border bg-white"
      aria-label={copy.marketReplay.chartAriaLabel}
    />
  );
}
