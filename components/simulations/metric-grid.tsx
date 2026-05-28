import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { SimulationSummary } from "@/lib/monte-carlo/types";

export function MetricGrid({ summary }: { summary: SimulationSummary }) {
  const sections = [
    {
      title: "Breakeven Analysis",
      metrics: [
        ["Profitable Scenarios", summary.profitableScenarios.toLocaleString()],
        ["Losing Scenarios", summary.losingScenarios.toLocaleString()],
        ["Busted Scenarios", summary.bustedScenarios.toLocaleString()],
        ["Profit Probability", formatPercent(summary.profitProbability)],
        ["Ruin Probability", formatPercent(summary.ruinProbability)],
      ],
    },
    {
      title: "Equity Performance",
      metrics: [
        ["Average Final Equity", formatMoney(summary.averageFinalEquity)],
        ["Median Final Equity", formatMoney(summary.medianFinalEquity)],
        ["Best Case / High Bound", formatMoney(summary.bestFinalEquity)],
        ["Worst Case / Low Bound", formatMoney(summary.worstFinalEquity)],
      ],
    },
    {
      title: "Drawdown Depth",
      metrics: [
        ["Avg Max Drawdown", formatMoney(summary.averageMaxDrawdown)],
        ["Worst Max Drawdown", formatMoney(summary.worstMaxDrawdown)],
        ["Best Max Drawdown", formatMoney(summary.bestMaxDrawdown)],
      ],
    },
    {
      title: "Streaks",
      metrics: [
        ["Avg Losing Streak", formatNumber(summary.averageMaxLosingStreak)],
        ["Worst Losing Streak", summary.worstMaxLosingStreak.toLocaleString()],
        ["Best Losing Streak", summary.bestMaxLosingStreak.toLocaleString()],
      ],
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
            {section.metrics.map(([label, value]) => (
              <div key={label} className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 font-mono text-lg font-semibold text-slate-950">{value}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
