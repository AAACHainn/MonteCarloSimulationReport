"use client";

import { useEffect, useRef, useState } from "react";
import { QuickIntervalDialog } from "@/components/market-replay/quick-interval-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { hasVisibleReplayDialog } from "@/lib/market-replay/keyboard-shortcuts";
import { displayIntervalOptions } from "@/lib/market-replay/display-interval";
import { formatInterval } from "@/lib/market-replay/types";

export function DisplayIntervalControls({
  value, sourceIntervalSeconds, disabled = false, onChange,
}: {
  value: number;
  sourceIntervalSeconds: number | null;
  disabled?: boolean;
  onChange: (seconds: number) => Promise<boolean>;
}) {
  const [quickIntervalInitialValue, setQuickIntervalInitialValue] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const controlsDisabled = disabled || applying || sourceIntervalSeconds === null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (controlsDisabled || event.defaultPrevented || !/^\d$/.test(event.key)
        || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
        || event.isComposing || quickIntervalInitialValue !== null) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='listbox'], [role='menu'], [role='combobox']")
        || hasVisibleReplayDialog()) return;
      event.preventDefault();
      setQuickIntervalInitialValue(event.key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controlsDisabled, quickIntervalInitialValue]);

  async function applyInterval(seconds: number) {
    if (disabled || applyingRef.current) return false;
    applyingRef.current = true;
    setApplying(true);
    try { return await onChange(seconds); }
    finally { applyingRef.current = false; setApplying(false); }
  }

  return <>
    <Label htmlFor="display-interval" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displayInterval}</Label>
    <Select disabled={controlsDisabled} value={String(value)} onValueChange={(next) => void applyInterval(Number(next))}>
      <SelectTrigger id="display-interval" className="h-8 w-24"><SelectValue /></SelectTrigger>
      <SelectContent>
        {displayIntervalOptions(sourceIntervalSeconds, value).map((seconds) => <SelectItem key={seconds} value={String(seconds)}>{formatInterval(seconds)}</SelectItem>)}
      </SelectContent>
    </Select>
    {sourceIntervalSeconds !== null ? <QuickIntervalDialog
      open={quickIntervalInitialValue !== null}
      initialValue={quickIntervalInitialValue ?? ""}
      sourceIntervalSeconds={sourceIntervalSeconds}
      onClose={() => setQuickIntervalInitialValue(null)}
      onApply={applyInterval}
    /> : null}
  </>;
}
