"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import type { SimulationSummary } from "@/lib/monte-carlo/types";

export function Histograms({ summary }: { summary: SimulationSummary }) {
  const charts = [
    {
      title: copy.report.finalEquityHistogram,
      data: summary.finalEquityHistogram,
      xKey: "label",
    },
    {
      title: copy.report.maxDrawdownHistogram,
      data: summary.maxDrawdownHistogram,
      xKey: "label",
    },
    {
      title: copy.report.losingStreakDistribution,
      data: summary.losingStreakDistribution,
      xKey: "streak",
    },
  ];

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
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
