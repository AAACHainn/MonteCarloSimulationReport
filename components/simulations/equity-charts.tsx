"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import type { PercentileCurves, SimulationPath } from "@/lib/monte-carlo/types";
import type { ChartValueMode } from "./report-charts";

const percentileColors = {
  p5: "#dc2626",
  p25: "#f59e0b",
  p50: "#2563eb",
  p75: "#0d9488",
  p95: "#16a34a",
};

export function EquityCharts({
  samplePaths,
  percentileCurves,
  initialCapital,
  valueMode,
}: {
  samplePaths: SimulationPath[];
  percentileCurves: PercentileCurves;
  initialCapital: number;
  valueMode: ChartValueMode;
}) {
  const sampleData = buildSampleData(samplePaths, initialCapital, valueMode);
  const percentileData = percentileCurves.p50.map((point, index) => ({
    tradeIndex: point.tradeIndex,
    p5: formatOptionalChartValue(percentileCurves.p5[index]?.equity, initialCapital, valueMode),
    p25: formatOptionalChartValue(percentileCurves.p25[index]?.equity, initialCapital, valueMode),
    p50: formatOptionalChartValue(percentileCurves.p50[index]?.equity, initialCapital, valueMode),
    p75: formatOptionalChartValue(percentileCurves.p75[index]?.equity, initialCapital, valueMode),
    p95: formatOptionalChartValue(percentileCurves.p95[index]?.equity, initialCapital, valueMode),
  }));
  const tickFormatter = (value: number) => formatAxisValue(value, valueMode);
  const tooltipFormatter = (value: number) => formatTooltipValue(value, valueMode);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{copy.report.sampleCurves}</CardTitle>
        </CardHeader>
        <CardContent className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sampleData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="tradeIndex" />
              <YAxis tickFormatter={tickFormatter} />
              <Tooltip formatter={(value) => tooltipFormatter(Number(value))} />
              {samplePaths.map((path) => (
                <Line
                  key={path.index}
                  type="monotone"
                  dataKey={`path${path.index}`}
                  dot={false}
                  stroke="#64748b"
                  strokeOpacity={0.22}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.report.percentileCurves}</CardTitle>
        </CardHeader>
        <CardContent className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={percentileData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="tradeIndex" />
              <YAxis tickFormatter={tickFormatter} />
              <Tooltip formatter={(value) => tooltipFormatter(Number(value))} />
              <Legend />
              {Object.entries(percentileColors).map(([key, color]) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  dot={false}
                  stroke={color}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function buildSampleData(samplePaths: SimulationPath[], initialCapital: number, valueMode: ChartValueMode) {
  const maxLength = Math.max(...samplePaths.map((path) => path.equityCurve.length), 0);
  return Array.from({ length: maxLength }, (_, index) => {
    const row: Record<string, number> = { tradeIndex: index };
    for (const path of samplePaths) {
      row[`path${path.index}`] = formatChartValue(path.equityCurve[index]?.equity ?? path.finalEquity, initialCapital, valueMode);
    }
    return row;
  });
}

function formatChartValue(value: number, initialCapital: number, valueMode: ChartValueMode) {
  return valueMode === "percent" ? ((value - initialCapital) / initialCapital) * 100 : value;
}

function formatOptionalChartValue(value: number | undefined, initialCapital: number, valueMode: ChartValueMode) {
  return value === undefined ? undefined : formatChartValue(value, initialCapital, valueMode);
}

function formatAxisValue(value: number, valueMode: ChartValueMode) {
  return valueMode === "percent" ? `${value.toFixed(0)}%` : `$${value.toFixed(0)}`;
}

function formatTooltipValue(value: number, valueMode: ChartValueMode) {
  return valueMode === "percent" ? `${value.toFixed(2)}%` : `$${value.toFixed(2)}`;
}
