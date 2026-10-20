"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { BAR_EMISSION_MODES, type BarEmissionMode } from "@/lib/market-replay/types";

export function BarEmissionModeField({ id, value, onChange, name, disabled }: {
  id: string; value: BarEmissionMode; onChange: (value: BarEmissionMode) => void; name?: string; disabled?: boolean;
}) {
  return <div className="space-y-2">
    <Label htmlFor={id}>{copy.marketReplay.barEmission.label}</Label>
    <Select name={name} value={value} onValueChange={(next) => onChange(next as BarEmissionMode)} disabled={disabled}>
      <SelectTrigger id={id} aria-describedby={`${id}-hint`}><SelectValue /></SelectTrigger>
      <SelectContent>{BAR_EMISSION_MODES.map(mode => <SelectItem key={mode} value={mode}>{copy.marketReplay.barEmission.modes[mode]}</SelectItem>)}</SelectContent>
    </Select>
    <p id={`${id}-hint`} className="text-xs text-slate-500">{copy.marketReplay.barEmission.hint}</p>
  </div>;
}
