import Link from "next/link";
import { Database } from "lucide-react";
import { DatasetForm } from "@/components/datasets/dataset-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  const datasets = await prisma.tradeDataset.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { trades: true, simulationRuns: true },
      },
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{copy.datasets.createTitle}</CardTitle>
          <CardDescription>{copy.datasets.createDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <DatasetForm />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{copy.datasets.title}</h1>
            <p className="text-sm text-slate-600">{copy.datasets.subtitle}</p>
          </div>
        </div>

        <div className="grid gap-3">
          {datasets.length === 0 ? (
            <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">{copy.datasets.empty}</p>
          ) : (
            datasets.map((dataset) => (
              <Card key={dataset.id}>
                <CardContent className="flex items-center justify-between gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <Database className="mt-1 h-5 w-5 text-blue-700" />
                    <div>
                      <h2 className="font-semibold text-slate-950">{dataset.name}</h2>
                      <p className="text-sm text-slate-600">{dataset.description || copy.datasets.noDescription}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {dataset._count.trades} {copy.datasets.trades} · {dataset._count.simulationRuns}{" "}
                        {copy.datasets.simulations}
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="outline">
                    <Link href={`/datasets/${dataset.id}`}>{copy.home.open}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
