import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HistoryTable } from "@/components/simulations/history-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ datasetId?: string }>;
};

export default async function SimulationHistoryPage({ searchParams }: PageProps) {
  const { datasetId } = await searchParams;
  const dataset = datasetId
    ? await prisma.tradeDataset.findUnique({
        where: { id: datasetId },
        select: { name: true },
      })
    : null;
  const runs = await prisma.simulationRun.findMany({
    where: datasetId ? { datasetId } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      dataset: {
        select: { name: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: copy.simulations.historyTitle }]} />
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.simulations.historyEyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.simulations.historyTitle}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {dataset
            ? copy.simulations.filteredHistoryDescription.replace("{dataset}", dataset.name)
            : copy.simulations.historyDescription}
        </p>
      </section>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{copy.simulations.runs}</CardTitle>
            <CardDescription>{copy.simulations.runsDescription}</CardDescription>
          </div>
          {dataset ? (
            <Link
              href="/simulations/history"
              className="text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
            >
              {copy.simulations.viewAllRuns}
            </Link>
          ) : null}
        </CardHeader>
        <CardContent>
          <HistoryTable runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
