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
import type { PercentileCurves, SimulationPath } from "@/lib/monte-carlo/types";

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
}: {
  samplePaths: SimulationPath[];
  percentileCurves: PercentileCurves;
}) {
  const sampleData = buildSampleData(samplePaths);
  const percentileData = percentileCurves.p50.map((point, index) => ({
    tradeIndex: point.tradeIndex,
    p5: percentileCurves.p5[index]?.equity,
    p25: percentileCurves.p25[index]?.equity,
    p50: percentileCurves.p50[index]?.equity,
    p75: percentileCurves.p75[index]?.equity,
    p95: percentileCurves.p95[index]?.equity,
  }));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Sample Equity Curves</CardTitle>
        </CardHeader>
        <CardContent className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sampleData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="tradeIndex" />
              <YAxis tickFormatter={(value) => `$${Number(value).toFixed(0)}`} />
              <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
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
          <CardTitle>Percentile Equity Curves</CardTitle>
        </CardHeader>
        <CardContent className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={percentileData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="tradeIndex" />
              <YAxis tickFormatter={(value) => `$${Number(value).toFixed(0)}`} />
              <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
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

function buildSampleData(samplePaths: SimulationPath[]) {
  const maxLength = Math.max(...samplePaths.map((path) => path.equityCurve.length), 0);
  return Array.from({ length: maxLength }, (_, index) => {
    const row: Record<string, number> = { tradeIndex: index };
    for (const path of samplePaths) {
      row[`path${path.index}`] = path.equityCurve[index]?.equity ?? path.finalEquity;
    }
    return row;
  });
}
