import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { MetricGrid } from "@/components/simulations/metric-grid";
import { ReportHeader } from "@/components/simulations/report-header";
import { ReportCharts } from "@/components/simulations/report-charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { formatMoney, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import type {
  PercentileCurves,
  SimulationConfig,
  SimulationPath,
  SimulationSummary,
} from "@/lib/monte-carlo/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SimulationReportPage({ params }: PageProps) {
  const { id } = await params;
  const run = await prisma.simulationRun.findUnique({
    where: { id },
    include: {
      dataset: {
        select: { id: true, name: true },
      },
    },
  });

  if (!run) notFound();

  const config = JSON.parse(run.config) as SimulationConfig;
  const summary = JSON.parse(run.summary) as SimulationSummary;
  const samplePaths = JSON.parse(run.samplePaths) as SimulationPath[];
  const percentileCurves = JSON.parse(run.percentileCurves) as PercentileCurves;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: copy.simulations.historyTitle, href: "/simulations/history" },
          { label: copy.report.titlePrefix },
        ]}
      />
      <ReportHeader config={config} />

      <section className="flex flex-col gap-3 rounded-lg border bg-white p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{copy.report.dataset}</div>
          <div className="mt-1 font-semibold text-slate-950">{run.dataset.name}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MiniStat
            label={copy.report.p5Final}
            value={formatMoney(summary.percentileFinalEquity.p5)}
            subValue={formatEquityReturn(summary.percentileFinalEquity.p5, config.initialCapital)}
            tip={copy.report.p5FinalTip}
          />
          <MiniStat
            label={copy.report.p50Final}
            value={formatMoney(summary.percentileFinalEquity.p50)}
            subValue={formatEquityReturn(summary.percentileFinalEquity.p50, config.initialCapital)}
            tip={copy.report.p50FinalTip}
          />
          <MiniStat
            label={copy.report.p95Final}
            value={formatMoney(summary.percentileFinalEquity.p95)}
            subValue={formatEquityReturn(summary.percentileFinalEquity.p95, config.initialCapital)}
            tip={copy.report.p95FinalTip}
          />
          <MiniStat
            label={copy.report.worstFinal}
            value={formatMoney(summary.worstFinalEquity)}
            subValue={formatEquityReturn(summary.worstFinalEquity, config.initialCapital)}
            tip={copy.report.worstFinalTip}
          />
        </div>
        <Button asChild variant="outline">
          <Link href="/simulations/history">{copy.report.history}</Link>
        </Button>
      </section>

      <MetricGrid
        summary={summary}
        initialCapital={config.initialCapital}
        ruinThreshold={config.ruinThreshold}
        tradesPerSimulation={config.tradesPerSimulation}
      />

      <Card>
        <CardHeader>
          <CardTitle>{copy.report.charts}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReportCharts
            samplePaths={samplePaths}
            percentileCurves={percentileCurves}
            summary={summary}
            initialCapital={config.initialCapital}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function formatEquityReturn(value: number, initialCapital: number) {
  return formatPercent(((value - initialCapital) / initialCapital) * 100);
}

function MiniStat({
  label,
  value,
  subValue,
  tip,
}: {
  label: string;
  value: string;
  subValue: string;
  tip: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        <span className="group relative inline-flex">
          <CircleAlert
            className="h-3.5 w-3.5 cursor-help text-slate-400"
            aria-label={tip}
          />
          <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-md border bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-relaxed tracking-normal text-white shadow-lg group-hover:block">
            {tip}
          </span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-semibold text-slate-950">{value}</span>
        <span className="font-mono text-xs font-semibold text-slate-500">{subValue}</span>
      </div>
    </div>
  );
}
