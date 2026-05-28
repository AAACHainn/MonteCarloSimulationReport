import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/format";
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
    return <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">No simulation runs yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Created</TableHead>
          <TableHead>Dataset</TableHead>
          <TableHead className="text-right">Scenarios</TableHead>
          <TableHead className="text-right">Median Final</TableHead>
          <TableHead className="text-right">Ruin</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const config = JSON.parse(run.config as string) as SimulationConfig;
          const summary = JSON.parse(run.summary as string) as SimulationSummary;
          return (
            <TableRow key={run.id}>
              <TableCell>{run.createdAt.toLocaleString()}</TableCell>
              <TableCell>{run.dataset.name}</TableCell>
              <TableCell className="text-right">{config.simulationCount.toLocaleString()}</TableCell>
              <TableCell className="text-right">{formatMoney(summary.medianFinalEquity)}</TableCell>
              <TableCell className="text-right">{formatPercent(summary.ruinProbability)}</TableCell>
              <TableCell className="text-right">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/simulations/${run.id}`}>Open</Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
