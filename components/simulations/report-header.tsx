import { Badge } from "@/components/ui/badge";
import { formatMoney, formatPercent } from "@/lib/format";
import type { SimulationConfig } from "@/lib/monte-carlo/types";

export function ReportHeader({ config }: { config: SimulationConfig }) {
  return (
    <section className="space-y-4 border-b pb-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-sm uppercase tracking-wide text-blue-700">SIMULATION REPORT</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            SIMULATION REPORT - {config.simulationCount.toLocaleString()} Scenarios
          </h1>
        </div>
        <Badge className="w-fit bg-white text-slate-700">Bootstrap with replacement</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <ConfigItem label="Initial Capital" value={formatMoney(config.initialCapital)} />
        <ConfigItem label="Display Range" value={`${config.tradesPerSimulation} trades`} />
        <ConfigItem label="Ruin Threshold" value={formatMoney(config.ruinThreshold)} />
        <ConfigItem label="Risk Per Trade" value={formatPercent(config.riskPercent)} />
        <ConfigItem label="Compounding Mode" value={config.compoundingMode.replaceAll("_", " ")} />
      </div>
    </section>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}
