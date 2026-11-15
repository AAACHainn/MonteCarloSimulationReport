"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import type { DisplaySession } from "@/lib/market-replay/types";

export function DisplaySessionControls({ value, available, disabled = false, onChange }: {
  value: DisplaySession; available: DisplaySession[]; disabled?: boolean;
  onChange: (value: DisplaySession) => unknown;
}) {
  const id = useId();
  if (available.length < 2) return null;
  return <>
    <Label htmlFor={id} className="whitespace-nowrap text-xs text-slate-500 dark:text-muted-foreground">{copy.marketReplay.displaySession}</Label>
    <Select disabled={disabled} value={value} onValueChange={next => { void onChange(next as DisplaySession); }}>
      <SelectTrigger id={id} className="h-8 w-20" title={copy.marketReplay.displaySessionHint}><SelectValue /></SelectTrigger>
      <SelectContent>
        {available.map(session => <SelectItem key={session} value={session}>
          {session === "RTH" ? copy.marketReplay.displaySessionRth : copy.marketReplay.displaySessionEth}
        </SelectItem>)}
      </SelectContent>
    </Select>
  </>;
}
