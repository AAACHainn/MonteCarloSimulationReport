import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleHelp, Download } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DeleteDatasetButton } from "@/components/datasets/delete-dataset-button";
import { TradeTable } from "@/components/datasets/trade-table";
import { TradeUpload } from "@/components/datasets/trade-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function DatasetDetailPage({ params }: PageProps) {
  const { id } = await params;
  const dataset = await prisma.tradeDataset.findFirst({
    where: { id, tradeJournal: null },
    include: {
      trades: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
      _count: {
        select: { simulationRuns: true },
      },
    },
  });

  if (!dataset) notFound();

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: copy.datasets.title, href: "/datasets" },
          { label: dataset.name },
        ]}
      />
      <section className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.datasets.detailEyebrow}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{dataset.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            {dataset.description || copy.datasets.noDescription}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>
              {dataset.trades.length} {copy.datasets.trades} / {dataset._count.simulationRuns}{" "}
              {copy.datasets.savedSimulations}
            </span>
            <Link
              href={`/simulations/history?datasetId=${dataset.id}`}
              className="font-medium text-blue-700 hover:text-blue-900 hover:underline"
            >
              {copy.datasets.viewSimulationRecords}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href={`/simulations/new?datasetId=${dataset.id}`}>{copy.datasets.runSimulation}</Link>
          </Button>
          <span className="group relative inline-flex">
            <CircleHelp
              className="h-4 w-4 cursor-help text-slate-400 hover:text-blue-700"
              aria-label={copy.datasets.simulationFormulaTip}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-80 -translate-x-1/2 rounded-md border bg-slate-950 px-3 py-2 text-left text-xs leading-relaxed text-white shadow-lg group-hover:block">
              {copy.datasets.simulationFormulaTip}
            </span>
          </span>
          <DeleteDatasetButton datasetId={dataset.id} />
        </div>
      </section>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{copy.datasets.csvUpload}</CardTitle>
            <CardDescription>{copy.datasets.csvDescription}</CardDescription>
          </div>
          <Button asChild variant="outline" className="w-fit shrink-0">
            <a href="/templates/trades-template.csv" download>
              <Download className="h-4 w-4" />
              {copy.datasets.downloadTemplate}
            </a>
          </Button>
        </CardHeader>
        <CardContent>
          <TradeUpload datasetId={dataset.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.datasets.tradesTitle}</CardTitle>
          <CardDescription>{copy.datasets.tradesDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <TradeTable trades={dataset.trades} />
        </CardContent>
      </Card>
    </div>
  );
}
