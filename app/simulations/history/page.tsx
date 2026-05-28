import { HistoryTable } from "@/components/simulations/history-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SimulationHistoryPage() {
  const runs = await prisma.simulationRun.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      dataset: {
        select: { name: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">Saved Runs</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Simulation History</h1>
        <p className="mt-2 text-sm text-slate-600">Open saved reports without rerunning the simulation engine.</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>Each row stores config, summary, sample paths, and percentile curves.</CardDescription>
        </CardHeader>
        <CardContent>
          <HistoryTable runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
