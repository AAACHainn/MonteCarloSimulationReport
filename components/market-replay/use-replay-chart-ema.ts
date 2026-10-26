"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { copy } from "@/lib/i18n";
import { canUpdateReplayTail } from "@/lib/market-replay/chart-data";
import { calculateEmaSeries, nextEma } from "@/lib/market-replay/ema";
import { emaSeriesStyleOptions } from "@/lib/market-replay/ema-style";
import type { AggregatedMarketBarData, EmaIndicatorConfig } from "@/lib/market-replay/types";

type EmaRenderState = {
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  length: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  barCount: number;
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

  // Remove old timeline points before the candle effect maps the next window's range.
  // In particular, retained hidden lines must not pin a discarded history/timeframe.
  useLayoutEffect(() => {
    if (ownerChartRef.current !== chartRef.current) return;
    for (const [id, previous] of stateRef.current) {
      if (previous.bars !== bars && !canUpdateReplayTail(previous.bars, bars, "", "")) {
        seriesRef.current.get(id)?.setData([]);
        stateRef.current.delete(id);
      }
    }
  }, [bars, chartRef]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (ownerChartRef.current !== chart) {
      ownerChartRef.current = chart;
      seriesRef.current.clear();
      stateRef.current.clear();
    }
    const configuredIds = new Set(indicators.map((item) => item.id));
    for (const [id, series] of seriesRef.current) {
      if (!configuredIds.has(id)) {
        chart.removeSeries(series);
        seriesRef.current.delete(id);
        stateRef.current.delete(id);
      }
    }
    const all = [...warmupBars, ...bars];
    for (const indicator of indicators) {
      const visible = enabled && indicator.visible;
      let series = seriesRef.current.get(indicator.id);
      const previous = stateRef.current.get(indicator.id);
      if (!visible) {
        series?.applyOptions({ visible: false });
        // A hidden series must not keep timestamps from an old window/timeframe.
        if (series && previous && (previous.bars !== bars || previous.warmupBars !== warmupBars)) {
          series.setData([]);
          stateRef.current.delete(indicator.id);
        }
        continue;
      }
      if (!series) {
        series = chart.addSeries(LineSeries, {
          ...emaSeriesStyleOptions(indicator),
          title: copy.marketReplay.emaLine(indicator.length),
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          // Keep the candle scale and axis width independent of indicator visibility.
          autoscaleInfoProvider: () => null,
          lastValueVisible: false,
          visible: false,
        });
        seriesRef.current.set(indicator.id, series);
      }
      const renderOptions = {
        ...emaSeriesStyleOptions(indicator),
        title: copy.marketReplay.emaLine(indicator.length),
        visible: true,
      };
      if (previous?.length === indicator.length && previous.bars === bars && previous.warmupBars === warmupBars) {
        series.applyOptions(renderOptions);
        continue;
      }
      const samePrefix = previous?.length === indicator.length
        && all.length >= previous.barCount
        && previous.firstTimestamp === (all[0]?.timestamp ?? null)
        && previous.lastTimestamp === (all[previous.barCount - 1]?.timestamp ?? null);
      if (!previous || !samePrefix) {
        const result = calculateEmaSeries(all, indicator.length, all.length - 1, 0);
        const values: Array<number | null> = Array(all.length).fill(null);
        for (const point of result.points) values[point.sequence] = point.value;
        series.setData(result.points.filter((point) => point.sequence >= warmupBars.length)
          .map((point) => ({ time: chartTime(all[point.sequence].timestamp), value: point.value })));
        stateRef.current.set(indicator.id, {
          bars, warmupBars,
          length: indicator.length,
          firstTimestamp: all[0]?.timestamp ?? null,
          lastTimestamp: all.at(-1)?.timestamp ?? null,
          barCount: all.length,
          values,
        });
        series.applyOptions(renderOptions);
        continue;
      }
      const values = previous.values;
      values.length = Math.min(values.length, all.length);
      while (values.length < all.length) values.push(null);
      const start = Math.max(indicator.length - 1, previous.barCount - 1);
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
        bars, warmupBars,
        length: indicator.length,
        firstTimestamp: all[0]?.timestamp ?? null,
        lastTimestamp: all.at(-1)?.timestamp ?? null,
        barCount: all.length,
        values,
      });
      series.applyOptions(renderOptions);
    }
  }, [bars, chartKey, chartRef, enabled, indicators, warmupBars]);
}
