"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import {
  QUICK_INTERVAL_UNITS,
  getQuickIntervalRange,
  parseQuickInterval,
  type QuickIntervalUnit,
} from "@/lib/market-replay/quick-interval";

type QuickIntervalDialogProps = {
  open: boolean;
  initialValue: string;
  sourceIntervalSeconds: number;
  onClose: () => void;
  onApply: (seconds: number) => Promise<boolean>;
};

function unitLabel(unit: QuickIntervalUnit) {
  if (unit === "s") return copy.marketReplay.intervalSeconds;
  if (unit === "h") return copy.marketReplay.intervalHours;
  return copy.marketReplay.intervalMinutes;
}

export function QuickIntervalDialog({
  open,
  initialValue,
  sourceIntervalSeconds,
  onClose,
  onApply,
}: QuickIntervalDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [unit, setUnit] = useState<QuickIntervalUnit>("m");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const range = getQuickIntervalRange(sourceIntervalSeconds, unit);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setUnit("m");
    setError(null);
    setBusy(false);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const seconds = parseQuickInterval(value, unit, sourceIntervalSeconds);
    if (seconds === null) {
      setError(copy.marketReplay.invalidDisplayInterval);
      return;
    }
    setBusy(true);
    setError(null);
    let applied = false;
    try {
      applied = await onApply(seconds);
    } catch {
      applied = false;
    } finally {
      setBusy(false);
    }
    if (applied) onClose();
    else setError(copy.marketReplay.quickIntervalApplyError);
  }

  return (
    <Dialog
      open={open}
      title={copy.marketReplay.quickIntervalTitle}
      description={copy.marketReplay.quickIntervalDescription}
      className="max-w-sm"
      onClose={() => { if (!busy) onClose(); }}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <div className="space-y-2">
            <Label htmlFor="quick-display-interval">{copy.marketReplay.quickIntervalValue}</Label>
            <Input
              ref={inputRef}
              id="quick-display-interval"
              type="number"
              inputMode="numeric"
              min={range?.minimum ?? 1}
              max={range?.maximum}
              step={range?.step ?? 1}
              value={value}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error
                ? "quick-display-interval-help quick-display-interval-error"
                : "quick-display-interval-help"}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-display-interval-unit">{copy.marketReplay.intervalUnit}</Label>
            <Select
              value={unit}
              disabled={busy}
              onValueChange={(nextUnit) => {
                setUnit(nextUnit as QuickIntervalUnit);
                setError(null);
              }}
            >
              <SelectTrigger id="quick-display-interval-unit"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUICK_INTERVAL_UNITS.map((candidate) => (
                  <SelectItem
                    key={candidate}
                    value={candidate}
                    disabled={!getQuickIntervalRange(sourceIntervalSeconds, candidate)}
                  >
                    {unitLabel(candidate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p id="quick-display-interval-help" className="text-xs text-slate-500">
          {range
            ? copy.marketReplay.quickIntervalRange(range.minimum, range.maximum, range.step, unitLabel(unit))
            : copy.marketReplay.quickIntervalUnitUnavailable}
        </p>
        {error ? <p id="quick-display-interval-error" className="text-xs text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button>
          <Button type="submit" disabled={busy || !range}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? copy.marketReplay.quickIntervalApplying : copy.marketReplay.quickIntervalApply}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
