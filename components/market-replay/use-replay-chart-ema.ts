"use client";

import { useEffect, useRef, type RefObject } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { copy } from "@/lib/i18n";
import { calculateEmaSeries, nextEma } from "@/lib/market-replay/ema";
import { emaSeriesStyleOptions } from "@/lib/market-replay/ema-style";
import type { AggregatedMarketBarData, EmaIndicatorConfig } from "@/lib/market-replay/types";

type EmaRenderState = {
  length: number;
  bars: Array<{ timestamp: string; close: number }>;
  values: Array<number | null>;
};

function chartTime(timestamp: string) {
  return Math.floor(new Date(timestamp).getTime() / 1_000) as UTCTimestamp;
}

export function useReplayChartEma({
  chartRef,
  bars,
  warmupBars,
  enabled,
  indicators,
  chartKey,
}: {
  chartRef: RefObject<IChartApi | null>;
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  enabled: boolean;
  indicators: EmaIndicatorConfig[];
  chartKey: string | number;
}) {
  const seriesRef = useRef(new Map<string, ISeriesApi<"Line">>());
  const stateRef = useRef(new Map<string, EmaRenderState>());
  const ownerChartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (ownerChartRef.current !== chart) {
      ownerChartRef.current = chart;
      seriesRef.current.clear();
      stateRef.current.clear();
    }
    const active = enabled ? indicators.filter((item) => item.visible) : [];
    const activeIds = new Set(active.map((item) => item.id));
    for (const [id, series] of seriesRef.current) {
      if (!activeIds.has(id)) {
        chart.removeSeries(series);
        seriesRef.current.delete(id);
        stateRef.current.delete(id);
      }
    }
    const all = [...warmupBars, ...bars];
    for (const indicator of active) {
      let series = seriesRef.current.get(indicator.id);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          ...emaSeriesStyleOptions(indicator),
          title: copy.marketReplay.emaLine(indicator.length),
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        seriesRef.current.set(indicator.id, series);
      }
      series.applyOptions({
        ...emaSeriesStyleOptions(indicator),
        title: copy.marketReplay.emaLine(indicator.length),
      });
      const previous = stateRef.current.get(indicator.id);
      const samePrefix = previous?.length === indicator.length
        && all.length >= previous.bars.length
        && previous.bars.slice(0, -1).every((bar, index) => bar.timestamp === all[index]?.timestamp);
      if (!previous || !samePrefix) {
        const result = calculateEmaSeries(all, indicator.length, all.length - 1, 0);
        const values: Array<number | null> = Array(all.length).fill(null);
        for (const point of result.points) values[point.sequence] = point.value;
        series.setData(result.points.filter((point) => point.sequence >= warmupBars.length)
          .map((point) => ({ time: chartTime(all[point.sequence].timestamp), value: point.value })));
        stateRef.current.set(indicator.id, {
          length: indicator.length,
          bars: all.map((bar) => ({ timestamp: bar.timestamp, close: bar.close })),
          values,
        });
        continue;
      }
      const values = previous.values.slice(0, all.length);
      while (values.length < all.length) values.push(null);
      const start = Math.max(indicator.length - 1, previous.bars.length - 1);
      for (let index = start; index < all.length; index += 1) {
        if (index === indicator.length - 1) {
          values[index] = all.slice(0, indicator.length).reduce((sum, bar) => sum + bar.close, 0) / indicator.length;
        } else {
          const prior = values[index - 1];
          values[index] = prior === null ? null : nextEma(prior, all[index].close, indicator.length);
        }
        if (values[index] !== null && index >= warmupBars.length) {
          series.update({ time: chartTime(all[index].timestamp), value: values[index]! });
        }
      }
      stateRef.current.set(indicator.id, {
        length: indicator.length,
        bars: all.map((bar) => ({ timestamp: bar.timestamp, close: bar.close })),
        values,
      });
    }
  }, [bars, chartKey, chartRef, enabled, indicators, warmupBars]);
}
