import { HistoryTable } from "@/components/simulations/history-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

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
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.simulations.historyEyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.simulations.historyTitle}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy.simulations.historyDescription}</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{copy.simulations.runs}</CardTitle>
          <CardDescription>{copy.simulations.runsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <HistoryTable runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
