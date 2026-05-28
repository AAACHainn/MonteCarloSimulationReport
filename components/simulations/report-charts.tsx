"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import type { PercentileCurves, SimulationPath, SimulationSummary } from "@/lib/monte-carlo/types";
import { EquityCharts } from "./equity-charts";
import { Histograms } from "./histograms";

export type ChartValueMode = "amount" | "percent";

export function ReportCharts({
  samplePaths,
  percentileCurves,
  summary,
  initialCapital,
}: {
  samplePaths: SimulationPath[];
  percentileCurves: PercentileCurves;
  summary: SimulationSummary;
  initialCapital: number;
}) {
  const [valueMode, setValueMode] = useState<ChartValueMode>("amount");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-600">{copy.report.chartValueMode}</div>
        <div className="flex rounded-md border bg-white p-1">
          <Button
            type="button"
            size="sm"
            variant={valueMode === "amount" ? "default" : "ghost"}
            onClick={() => setValueMode("amount")}
          >
            {copy.report.chartValueAmount}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={valueMode === "percent" ? "default" : "ghost"}
            onClick={() => setValueMode("percent")}
          >
            {copy.report.chartValuePercent}
          </Button>
        </div>
      </div>
      <EquityCharts
        samplePaths={samplePaths}
        percentileCurves={percentileCurves}
        initialCapital={initialCapital}
        valueMode={valueMode}
      />
      <Histograms summary={summary} initialCapital={initialCapital} valueMode={valueMode} />
    </div>
  );
}
