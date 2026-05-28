import Link from "next/link";
import { DeleteSimulationRunButton } from "@/components/simulations/delete-simulation-run-button";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import type { SimulationConfig, SimulationSummary } from "@/lib/monte-carlo/types";

type HistoryRun = {
  id: string;
  createdAt: Date;
  config: unknown;
  summary: unknown;
  dataset: {
    name: string;
  };
};

export function HistoryTable({ runs }: { runs: HistoryRun[] }) {
  if (runs.length === 0) {
    return <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">{copy.simulations.noRuns}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.simulations.created}</TableHead>
          <TableHead>{copy.simulations.dataset}</TableHead>
          <TableHead className="text-right">{copy.simulations.scenarios}</TableHead>
          <TableHead className="text-right">{copy.simulations.medianFinal}</TableHead>
          <TableHead className="text-right">{copy.simulations.ruin}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const config = JSON.parse(run.config as string) as SimulationConfig;
          const summary = JSON.parse(run.summary as string) as SimulationSummary;
          return (
            <TableRow key={run.id}>
              <TableCell>{run.createdAt.toLocaleString("zh-CN")}</TableCell>
              <TableCell>{run.dataset.name}</TableCell>
              <TableCell className="text-right">{config.simulationCount.toLocaleString("zh-CN")}</TableCell>
              <TableCell className="text-right">{formatMoney(summary.medianFinalEquity)}</TableCell>
              <TableCell className="text-right">{formatPercent(summary.ruinProbability)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/simulations/${run.id}`}>{copy.simulations.open}</Link>
                  </Button>
                  <DeleteSimulationRunButton runId={run.id} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
