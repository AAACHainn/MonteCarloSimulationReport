"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { MarketBarData } from "@/lib/market-replay/types";
import { REPLAY_HISTORY_BARS } from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
import { rangeAfterNewReplayBar } from "@/lib/market-replay/chart-range";

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
}: {
  bars: MarketBarData[];
  startSequence: number;
  currentSequence: number;
  timezone: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastSequenceRef = useRef(currentSequence);
  const initialSequenceRef = useRef(currentSequence);
  const hasVolume = useMemo(() => bars.some((bar) => bar.volume !== null), [bars]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
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

  return (
    <div
      ref={containerRef}
      className="h-[calc(100vh-21rem)] min-h-[600px] w-full overflow-hidden rounded-lg border bg-white"
      aria-label={copy.marketReplay.chartAriaLabel}
    />
  );
}
