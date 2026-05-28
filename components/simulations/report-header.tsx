import { Badge } from "@/components/ui/badge";
import { formatMoney, formatPercent } from "@/lib/format";
import { copy, formatCompoundingMode, formatSamplingMethod } from "@/lib/i18n";
import type { SimulationConfig } from "@/lib/monte-carlo/types";

export function ReportHeader({ config }: { config: SimulationConfig }) {
  return (
    <section className="space-y-4 border-b pb-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.report.titlePrefix}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            {copy.report.titlePrefix} - {config.simulationCount.toLocaleString("zh-CN")} {copy.report.scenarios}
          </h1>
        </div>
        <Badge className="w-fit bg-white text-slate-700">{formatSamplingMethod(config.samplingMethod)}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <ConfigItem label={copy.report.initialCapital} value={formatMoney(config.initialCapital)} />
        <ConfigItem label={copy.report.displayRange} value={`${config.tradesPerSimulation} ${copy.report.trades}`} />
        <ConfigItem label={copy.report.ruinThreshold} value={formatMoney(config.ruinThreshold)} />
        <ConfigItem label={copy.report.riskPerTrade} value={formatPercent(config.riskPercent)} />
        <ConfigItem label={copy.report.compoundingMode} value={formatCompoundingMode(config.compoundingMode)} />
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
