"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { copy } from "@/lib/i18n";
import type { TrainingGateMode, TrainingGateState } from "@/lib/paper-trading/training-gate";

export function TrainingGateConfigDialog({ gate, busy, error, onClose, onSave }: {
  gate: TrainingGateState; busy: boolean; error: string | null; onClose: () => void;
  onSave: (config: { tradeCount: number; autoEnabled: boolean; lossThreshold: number; nextMode: TrainingGateMode }, start: boolean) => Promise<void>;
}) {
  const [count, setCount] = useState(String(gate.tradeCount));
  const [autoEnabled, setAutoEnabled] = useState(gate.autoEnabled);
  const [threshold, setThreshold] = useState(String(gate.lossThreshold));
  const [nextMode, setNextMode] = useState<TrainingGateMode>(gate.nextMode);
  const pendingSave = useRef(false);
  const number = Number(count);
  const thresholdNumber = Number(threshold);
  const validCount = Number.isInteger(number) && number > 0 && number <= 2147483647;
  const validThreshold = Number.isInteger(thresholdNumber) && thresholdNumber > 0 && thresholdNumber <= 2147483647;
  const valid = validCount && (!autoEnabled || validThreshold);
  const readOnly = busy || gate.active;
  const close = () => { if (!busy && !pendingSave.current) onClose(); };
  async function save(start: boolean) {
    if (readOnly || !valid || pendingSave.current) return;
    pendingSave.current = true;
    try {
      await onSave({ tradeCount: number, autoEnabled, lossThreshold: validThreshold ? thresholdNumber : gate.lossThreshold, nextMode }, start);
    } finally {
      pendingSave.current = false;
    }
  }
  return <Dialog open title={copy.trainingGate.title} description={copy.trainingGate.description}
    contentClassName="flex flex-col p-0" onClose={close}>
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5" aria-busy={busy}>
      {gate.active ? <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
        <p>{gate.source === "LOSS_STREAK" ? copy.trainingGate.automatic : copy.trainingGate.manual} · {copy.trainingGate.activeMode}：{copy.trainingGate.modes[gate.activeMode ?? "CHECKLIST"]}</p>
        <p className="tabular-nums">{copy.trainingGate.progress(gate.completedCount, gate.targetCount)}</p>
        <p>{copy.trainingGate.locked}</p>
        {gate.cancelledOrderCount ? <p>{copy.trainingGate.cancelled(gate.cancelledOrderCount)}</p> : null}
      </div> : null}
      <div className="flex items-center justify-between gap-3 rounded-md border bg-slate-50 px-4 py-3 text-sm">
        <p className="font-semibold text-slate-700">{copy.trainingGate.autoStatusLabel}</p>
        <p className="flex items-center gap-2 tabular-nums text-slate-600">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${gate.autoEnabled ? "bg-primary" : "bg-slate-400"}`} />
          {copy.trainingGate.autoStatusValue(gate.autoEnabled, gate.lossThreshold, gate.lossStreak)}
        </p>
      </div>

      <section aria-labelledby="gate-config-heading" className="space-y-4">
        <div className="flex items-baseline gap-2">
          <h3 id="gate-config-heading" className="text-sm font-semibold text-slate-950">{copy.trainingGate.configuration}</h3>
          <p className="text-xs text-slate-500">{copy.trainingGate.configurationHint}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gate-trade-count">{copy.trainingGate.tradeCount}</Label>
            <Input id="gate-trade-count" type="number" min={1} max={2147483647} step={1} value={count}
              disabled={readOnly} onChange={event => setCount(event.target.value)}
              aria-invalid={!validCount} aria-describedby={validCount ? "gate-count-hint" : "gate-count-hint gate-count-error"} />
            <p id="gate-count-hint" className="text-xs text-slate-500">{copy.trainingGate.countHint}</p>
            {!validCount ? <p id="gate-count-error" className="text-xs text-red-600" role="alert">{copy.trainingGate.invalidCount}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="gate-next-mode">{copy.trainingGate.nextMode}</Label>
            <Select value={nextMode} onValueChange={value => setNextMode(value as TrainingGateMode)} disabled={readOnly}>
              <SelectTrigger id="gate-next-mode"><SelectValue /></SelectTrigger>
              <SelectContent onEscapeKeyDown={event => event.stopPropagation()}>
                <SelectItem value="PLAN">{copy.trainingGate.modes.PLAN}</SelectItem>
                <SelectItem value="CHECKLIST">{copy.trainingGate.modes.CHECKLIST}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section aria-labelledby="gate-auto-heading" className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h3 id="gate-auto-heading" className="text-sm font-semibold text-slate-950">{copy.trainingGate.automation}</h3>
          <p className="text-xs text-slate-500">{copy.trainingGate.automationHint}</p>
        </div>
        <div className="overflow-hidden rounded-md border">
          <div className="flex items-center justify-between gap-4 border-b bg-slate-50 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="gate-auto-enabled">{copy.trainingGate.autoEnabled}</Label>
              <p id="gate-auto-hint" className="text-xs text-slate-500">{copy.trainingGate.autoEnabledHint}</p>
            </div>
            <Switch id="gate-auto-enabled" checked={autoEnabled} disabled={readOnly} onCheckedChange={setAutoEnabled} aria-describedby="gate-auto-hint" />
          </div>
          <div className="space-y-2 p-4">
            <Label htmlFor="gate-loss-threshold">{copy.trainingGate.lossThreshold}</Label>
            <Input id="gate-loss-threshold" type="number" min={1} max={2147483647} step={1} value={threshold}
              disabled={readOnly || !autoEnabled} onChange={event => setThreshold(event.target.value)} className="w-56 max-w-full"
              aria-invalid={autoEnabled && !validThreshold} aria-describedby={autoEnabled && !validThreshold ? "gate-loss-hint gate-loss-error" : "gate-loss-hint"} />
            <p id="gate-loss-hint" className="text-xs text-slate-500">{copy.trainingGate.lossThresholdHint}</p>
            {autoEnabled && !validThreshold ? <p id="gate-loss-error" className="text-xs text-red-600" role="alert">{copy.trainingGate.invalidThreshold}</p> : null}
          </div>
        </div>
      </section>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
    </div>
    <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-5 py-4" aria-busy={busy}>
      <Button type="button" variant="outline" disabled={busy} onClick={close}>{copy.common.cancel}</Button>
      {!gate.active ? <>
        <Button type="button" variant="outline" disabled={busy || !valid} onClick={() => void save(false)}>{copy.trainingGate.save}</Button>
        <Button type="button" disabled={busy || !valid} onClick={() => void save(true)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.trainingGate.start}
        </Button>
      </> : null}
    </div>
  </Dialog>;
}
