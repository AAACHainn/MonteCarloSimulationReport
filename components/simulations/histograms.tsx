"use client";

import { useMemo } from "react";
import { useAppearance } from "@/components/appearance-provider";
import { resolveChartTheme, chartTooltipStyle } from "@/lib/chart-theme";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import type { SimulationSummary } from "@/lib/monte-carlo/types";
import type { ChartValueMode } from "./report-charts";

export function Histograms({
  summary,
  initialCapital,
  valueMode,
}: {
  summary: SimulationSummary;
  initialCapital: number;
  valueMode: ChartValueMode;
}) {
  const { mode } = useAppearance();
  const theme = resolveChartTheme(mode);
  const charts = useMemo(() => [
    {
      title: copy.report.finalEquityHistogram,
      data: summary.finalEquityHistogram.map((bin) => ({
        ...bin,
        displayLabel:
          valueMode === "percent"
            ? `${formatPercentRange(((bin.start - initialCapital) / initialCapital) * 100, ((bin.end - initialCapital) / initialCapital) * 100)}`
            : formatMoneyRange(bin.start, bin.end),
      })),
      xKey: "displayLabel",
    },
    {
      title: copy.report.maxDrawdownHistogram,
      data: summary.maxDrawdownHistogram.map((bin) => ({
        ...bin,
        displayLabel:
          valueMode === "percent"
            ? formatPercentRange((bin.start / initialCapital) * 100, (bin.end / initialCapital) * 100)
            : formatMoneyRange(bin.start, bin.end),
      })),
      xKey: "displayLabel",
    },
    {
      title: copy.report.losingStreakDistribution,
      data: summary.losingStreakDistribution,
      xKey: "streak",
    },
  ], [summary, initialCapital, valueMode]);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {charts.map((chart) => (
        <Card key={chart.title}>
          <CardHeader>
            <CardTitle>{chart.title}</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart.data}>
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
                <XAxis stroke={theme.text} axisLine={{ stroke: theme.border }} tickLine={{ stroke: theme.border }} dataKey={chart.xKey} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis stroke={theme.text} axisLine={{ stroke: theme.border }} tickLine={{ stroke: theme.border }} />
                <Tooltip contentStyle={chartTooltipStyle(theme)} labelStyle={{ color: theme.tooltipText }} itemStyle={{ color: theme.tooltipText }} cursor={{ stroke: theme.crosshair, fill: theme.grid }} />
                <Bar dataKey="count" fill={theme.buy} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function formatMoneyRange(start: number, end: number) {
  return `$${start.toFixed(0)}-${end.toFixed(0)}`;
}

function formatPercentRange(start: number, end: number) {
  return `${start.toFixed(0)}%-${end.toFixed(0)}%`;
}
