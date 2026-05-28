import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import type { SimulationSummary } from "@/lib/monte-carlo/types";

export function MetricGrid({ summary }: { summary: SimulationSummary }) {
  const sections = [
    {
      title: copy.report.breakeven,
      metrics: [
        [copy.report.profitableScenarios, summary.profitableScenarios.toLocaleString("zh-CN")],
        [copy.report.losingScenarios, summary.losingScenarios.toLocaleString("zh-CN")],
        [copy.report.bustedScenarios, summary.bustedScenarios.toLocaleString("zh-CN")],
        [copy.report.profitProbability, formatPercent(summary.profitProbability)],
        [copy.report.ruinProbability, formatPercent(summary.ruinProbability)],
      ],
    },
    {
      title: copy.report.equityPerformance,
      metrics: [
        [copy.report.averageFinalEquity, formatMoney(summary.averageFinalEquity)],
        [copy.report.medianFinalEquity, formatMoney(summary.medianFinalEquity)],
        [copy.report.bestCase, formatMoney(summary.bestFinalEquity)],
        [copy.report.worstCase, formatMoney(summary.worstFinalEquity)],
      ],
    },
    {
      title: copy.report.drawdownDepth,
      metrics: [
        [copy.report.avgMaxDrawdown, formatMoney(summary.averageMaxDrawdown)],
        [copy.report.worstMaxDrawdown, formatMoney(summary.worstMaxDrawdown)],
        [copy.report.bestMaxDrawdown, formatMoney(summary.bestMaxDrawdown)],
      ],
    },
    {
      title: copy.report.streaks,
      metrics: [
        [copy.report.avgLosingStreak, formatNumber(summary.averageMaxLosingStreak)],
        [copy.report.worstLosingStreak, summary.worstMaxLosingStreak.toLocaleString("zh-CN")],
        [copy.report.bestLosingStreak, summary.bestMaxLosingStreak.toLocaleString("zh-CN")],
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
