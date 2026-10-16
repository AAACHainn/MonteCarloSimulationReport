"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import { limitFields, type AiLimits, type LimitKey } from "@/lib/ai/limits";

export function AiLimitsFields({ value, onChange, disabled = false, initialExpanded = false }: { value: AiLimits; onChange: (value: AiLimits) => void; disabled?: boolean; initialExpanded?: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(initialExpanded);
  const field = (key: LimitKey) => {
    const invalid = !Number.isInteger(value[key]) || value[key] < limitFields[key].min || value[key] > limitFields[key].max;
    return <div className="min-w-0 space-y-2" key={key}>
    <Label htmlFor={id + key}>{copy.ai.limitLabels[key]}</Label>
    <Input id={id + key} type="number" inputMode="numeric" min={limitFields[key].min} max={limitFields[key].max} step={1} required disabled={disabled}
      value={Number.isNaN(value[key]) ? "" : value[key]} aria-invalid={invalid} aria-describedby={id + key + "-hint"} onChange={(event) => onChange({ ...value, [key]: event.target.valueAsNumber })} className="tabular-nums" />
    <p className="text-xs leading-5 text-slate-500" id={id + key + "-hint"}>{copy.ai.limitHelp[key]} {copy.ai.limitRange(formatInteger(limitFields[key].min), formatInteger(limitFields[key].max))}</p>
  </div>; };
  return <div className="space-y-4">
    {field("outputTokens")}
    <details className="space-y-4" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary className="min-h-10 cursor-pointer rounded-md py-2 text-sm text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{copy.ai.advancedLimits}</summary>
      <div className="grid gap-4 sm:grid-cols-2">{(Object.keys(limitFields) as LimitKey[]).filter((key) => key !== "outputTokens").map(field)}</div>
    </details>
  </div>;
}
