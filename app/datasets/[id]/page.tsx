import Link from "next/link";
import { notFound } from "next/navigation";
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
  const dataset = await prisma.tradeDataset.findUnique({
    where: { id },
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
      <section className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.datasets.detailEyebrow}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{dataset.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            {dataset.description || copy.datasets.noDescription}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {dataset.trades.length} {copy.datasets.trades} · {dataset._count.simulationRuns}{" "}
            {copy.datasets.savedSimulations}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/simulations/new?datasetId=${dataset.id}`}>{copy.datasets.runSimulation}</Link>
          </Button>
          <DeleteDatasetButton datasetId={dataset.id} />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{copy.datasets.csvUpload}</CardTitle>
          <CardDescription>{copy.datasets.csvDescription}</CardDescription>
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
