import Link from "next/link";
import { notFound } from "next/navigation";
import { EquityCharts } from "@/components/simulations/equity-charts";
import { Histograms } from "@/components/simulations/histograms";
import { MetricGrid } from "@/components/simulations/metric-grid";
import { ReportHeader } from "@/components/simulations/report-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format";
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
      <ReportHeader config={config} />

      <section className="flex flex-col gap-3 rounded-lg border bg-white p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{copy.report.dataset}</div>
          <div className="mt-1 font-semibold text-slate-950">{run.dataset.name}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MiniStat label={copy.report.p5Final} value={formatMoney(summary.percentileFinalEquity.p5)} />
          <MiniStat label={copy.report.p50Final} value={formatMoney(summary.percentileFinalEquity.p50)} />
          <MiniStat label={copy.report.p95Final} value={formatMoney(summary.percentileFinalEquity.p95)} />
          <MiniStat label={copy.report.worstFinal} value={formatMoney(summary.worstFinalEquity)} />
        </div>
        <Button asChild variant="outline">
          <Link href="/simulations/history">{copy.report.history}</Link>
        </Button>
      </section>

      <MetricGrid summary={summary} />

      <Card>
        <CardHeader>
          <CardTitle>{copy.report.charts}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <EquityCharts samplePaths={samplePaths} percentileCurves={percentileCurves} />
          <Histograms summary={summary} />
        </CardContent>
      </Card>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}
