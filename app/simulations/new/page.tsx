import { SimulationForm } from "@/components/simulations/simulation-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";

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
    },
  });

  return (
    <div className="space-y-6">
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">Monte Carlo</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">New Simulation</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Configure capital, risk, compounding, ruin threshold, and bootstrap sample length.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Simulation Configuration</CardTitle>
          <CardDescription>Datasets without trades are hidden until a CSV has been uploaded.</CardDescription>
        </CardHeader>
        <CardContent>
          {datasets.length === 0 ? (
            <p className="text-sm text-slate-600">Create a dataset and upload trades before running a simulation.</p>
          ) : (
            <SimulationForm datasets={datasets} initialDatasetId={datasetId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
