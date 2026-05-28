import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteDatasetButton } from "@/components/datasets/delete-dataset-button";
import { TradeTable } from "@/components/datasets/trade-table";
import { TradeUpload } from "@/components/datasets/trade-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";

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
          <p className="font-mono text-sm uppercase tracking-wide text-blue-700">Trade Dataset</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{dataset.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{dataset.description || "No description"}</p>
          <p className="mt-2 text-xs text-slate-500">
            {dataset.trades.length} trades · {dataset._count.simulationRuns} saved simulations
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/simulations/new?datasetId=${dataset.id}`}>Run Simulation</Link>
          </Button>
          <DeleteDatasetButton datasetId={dataset.id} />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>CSV Upload</CardTitle>
          <CardDescription>
            Required source is either rMultiple, or pnl with riskAmount. Uploading replaces existing trades in this
            dataset.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TradeUpload datasetId={dataset.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trades</CardTitle>
          <CardDescription>Parsed historical trades used as the R-multiple bootstrap sample.</CardDescription>
        </CardHeader>
        <CardContent>
          <TradeTable trades={dataset.trades} />
        </CardContent>
      </Card>
    </div>
  );
}
