import { Breadcrumbs } from "@/components/breadcrumbs";
import { SimulationForm } from "@/components/simulations/simulation-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ datasetId?: string }>;
};

export default async function NewSimulationPage({ searchParams }: PageProps) {
  const { datasetId } = await searchParams;
  const datasets = await prisma.tradeDataset.findMany({
    where: {
      trades: {
        some: {},
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { trades: true },
      },
      tradeJournal: {
        select: { id: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: copy.simulations.newTitle }]} />
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.simulations.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.simulations.newTitle}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.simulations.newDescription}</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{copy.simulations.configTitle}</CardTitle>
          <CardDescription>{copy.simulations.configDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {datasets.length === 0 ? (
            <p className="text-sm text-slate-600">{copy.simulations.noTradableDatasets}</p>
          ) : (
            <SimulationForm datasets={datasets} initialDatasetId={datasetId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
