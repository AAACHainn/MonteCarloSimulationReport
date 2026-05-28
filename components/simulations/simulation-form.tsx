"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";

type DatasetOption = {
  id: string;
  name: string;
  _count: {
    trades: number;
  };
};

export function SimulationForm({
  datasets,
  initialDatasetId,
}: {
  datasets: DatasetOption[];
  initialDatasetId?: string;
}) {
  const router = useRouter();
  const initialDataset = datasets.some((dataset) => dataset.id === initialDatasetId)
    ? initialDatasetId
    : datasets[0]?.id;
  const [datasetId, setDatasetId] = useState(initialDataset ?? "");
  const [compoundingMode, setCompoundingMode] = useState("SIMPLE_FIXED_RISK");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedDataset = useMemo(() => datasets.find((dataset) => dataset.id === datasetId), [datasetId, datasets]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsRunning(true);
    const formData = new FormData(event.currentTarget);

    const response = await fetch("/api/simulations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        datasetId,
        initialCapital: formData.get("initialCapital"),
        riskPercent: formData.get("riskPercent"),
        simulationCount: formData.get("simulationCount"),
        tradesPerSimulation: formData.get("tradesPerSimulation"),
        compoundingMode,
        stepSize: formData.get("stepSize") || null,
        ruinThreshold: formData.get("ruinThreshold"),
        samplingMethod: "BOOTSTRAP_WITH_REPLACEMENT",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.formErrors?.[0] ?? data.error ?? copy.simulations.failed);
      setIsRunning(false);
      return;
    }

    router.push(`/simulations/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <Label>{copy.simulations.dataset}</Label>
        <Select value={datasetId} onValueChange={setDatasetId}>
          <SelectTrigger>
            <SelectValue placeholder="Select dataset" />
          </SelectTrigger>
          <SelectContent>
            {datasets.map((dataset) => (
              <SelectItem key={dataset.id} value={dataset.id}>
                {dataset.name} ({dataset._count.trades} trades)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Field label={copy.simulations.initialCapital} name="initialCapital" type="number" defaultValue="10000" min="1" step="0.01" />
      <Field label={copy.simulations.riskPerTrade} name="riskPercent" type="number" defaultValue="1" min="0.01" max="100" step="0.01" />
      <Field label={copy.simulations.simulationCount} name="simulationCount" type="number" defaultValue="10000" min="1" max="50000" />
      <Field
        label={copy.simulations.tradesPerSimulation}
        name="tradesPerSimulation"
        type="number"
        defaultValue={selectedDataset?._count.trades || 100}
        min="1"
        max="5000"
        key={selectedDataset?.id ?? "none"}
      />

      <div className="space-y-2">
        <Label>{copy.simulations.compoundingMode}</Label>
        <Select value={compoundingMode} onValueChange={setCompoundingMode}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SIMPLE_FIXED_RISK">{copy.simulations.simpleFixedRisk}</SelectItem>
            <SelectItem value="COMPOUND">{copy.simulations.compound}</SelectItem>
            <SelectItem value="STEP_COMPOUND">{copy.simulations.stepCompound}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Field
        label={copy.simulations.stepSize}
        name="stepSize"
        type="number"
        defaultValue="1000"
        min="0.01"
        step="0.01"
        disabled={compoundingMode !== "STEP_COMPOUND"}
      />
      <Field label={copy.simulations.ruinThreshold} name="ruinThreshold" type="number" defaultValue="2500" min="0" step="0.01" />

      <div className="space-y-2">
        <Label>{copy.simulations.samplingMethod}</Label>
        <Input value={copy.simulations.bootstrap} disabled />
      </div>

      {error ? <p className="text-sm text-red-600 md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={isRunning || !datasetId || datasets.length === 0}>
          <Play className="h-4 w-4" />
          {isRunning ? copy.simulations.running : copy.simulations.run}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.name}>{label}</Label>
      <Input id={props.name} {...props} />
    </div>
  );
}
