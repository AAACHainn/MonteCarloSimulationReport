import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import type { SimulationSummary } from "@/lib/monte-carlo/types";
import { CircleAlert } from "lucide-react";

type Metric = {
  label: string;
  value: string;
  subValue?: string;
  tip?: string;
};

export function MetricGrid({
  summary,
  initialCapital,
  ruinThreshold,
  tradesPerSimulation,
}: {
  summary: SimulationSummary;
  initialCapital: number;
  ruinThreshold: number;
  tradesPerSimulation: number;
}) {
  const finalEquityReturn = (value: number) => formatPercent(((value - initialCapital) / initialCapital) * 100);
  const drawdownPctOfInitial = (value: number) => formatPercent((value / initialCapital) * 100);
  const averageTradeProfit = (summary.averageFinalEquity - initialCapital) / tradesPerSimulation;
  const averageTradeProfitPct = ((summary.averageFinalEquity - initialCapital) / initialCapital / tradesPerSimulation) * 100;
  const ruinDrawdownPct = formatPercent(((initialCapital - ruinThreshold) / initialCapital) * 100);
  const bustedTip = copy.report.bustedScenariosTip
    .replace("{ruinThreshold}", formatMoney(ruinThreshold))
    .replace("{drawdownPct}", ruinDrawdownPct);
  const sections = [
    {
      title: copy.report.breakeven,
      metrics: [
        { label: copy.report.profitableScenarios, value: summary.profitableScenarios.toLocaleString("zh-CN") },
        { label: copy.report.losingScenarios, value: summary.losingScenarios.toLocaleString("zh-CN") },
        { label: copy.report.bustedScenarios, value: summary.bustedScenarios.toLocaleString("zh-CN"), tip: bustedTip },
        { label: copy.report.profitProbability, value: formatPercent(summary.profitProbability) },
        { label: copy.report.ruinProbability, value: formatPercent(summary.ruinProbability), tip: bustedTip },
      ] satisfies Metric[],
    },
    {
      title: copy.report.equityPerformance,
      metrics: [
        {
          label: copy.report.averageFinalEquity,
          value: formatMoney(summary.averageFinalEquity),
          subValue: finalEquityReturn(summary.averageFinalEquity),
        },
        {
          label: copy.report.medianFinalEquity,
          value: formatMoney(summary.medianFinalEquity),
          subValue: finalEquityReturn(summary.medianFinalEquity),
        },
        {
          label: copy.report.bestCase,
          value: formatMoney(summary.bestFinalEquity),
          subValue: finalEquityReturn(summary.bestFinalEquity),
        },
        {
          label: copy.report.worstCase,
          value: formatMoney(summary.worstFinalEquity),
          subValue: finalEquityReturn(summary.worstFinalEquity),
        },
        {
          label: copy.report.averageTradeProfit,
          value: formatMoney(averageTradeProfit),
          subValue: formatPercent(averageTradeProfitPct),
        },
      ] satisfies Metric[],
    },
    {
      title: copy.report.drawdownDepth,
      metrics: [
        {
          label: copy.report.avgMaxDrawdown,
          value: formatMoney(summary.averageMaxDrawdown),
          subValue: drawdownPctOfInitial(summary.averageMaxDrawdown),
        },
        {
          label: copy.report.worstMaxDrawdown,
          value: formatMoney(summary.worstMaxDrawdown),
          subValue: drawdownPctOfInitial(summary.worstMaxDrawdown),
        },
        {
          label: copy.report.bestMaxDrawdown,
          value: formatMoney(summary.bestMaxDrawdown),
          subValue: drawdownPctOfInitial(summary.bestMaxDrawdown),
        },
      ] satisfies Metric[],
    },
    {
      title: copy.report.streaks,
      metrics: [
        { label: copy.report.avgLosingStreak, value: formatNumber(summary.averageMaxLosingStreak) },
        { label: copy.report.worstLosingStreak, value: summary.worstMaxLosingStreak.toLocaleString("zh-CN") },
        { label: copy.report.bestLosingStreak, value: summary.bestMaxLosingStreak.toLocaleString("zh-CN") },
      ] satisfies Metric[],
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {section.metrics.map((metric) => (
              <MetricTile key={metric.label} metric={metric} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MetricTile({ metric }: { metric: Metric }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{metric.label}</span>
        {metric.tip ? (
          <span className="group relative inline-flex">
            <CircleAlert className="h-3.5 w-3.5 cursor-help text-slate-400" aria-label={metric.tip} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-72 -translate-x-1/2 rounded-md border bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-relaxed tracking-normal text-white shadow-lg group-hover:block">
              {metric.tip}
            </span>
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-lg font-semibold text-slate-950">{metric.value}</span>
        {metric.subValue ? (
          <span className="font-mono text-sm font-semibold text-slate-500">{metric.subValue}</span>
        ) : null}
      </div>
    </div>
  );
}
