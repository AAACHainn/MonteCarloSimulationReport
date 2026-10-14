"use client";
import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { copy } from "@/lib/i18n";
import { formatUtcOffset, utcOffsetDateTimeLocalValue, utcOffsetDateTimeToTimestamp } from "@/lib/market-replay/display-timezone";

export function ReplayDateDialog({ open, currentTime, minimum, maximum, displayUtcOffsetMinutes, allowForward, onClose, onLocate }: {
  open: boolean; currentTime: string; minimum: string; maximum: string; displayUtcOffsetMinutes: number; allowForward: boolean;
  onClose: () => void; onLocate: (timestamp: string, forward: boolean) => Promise<boolean>;
}) {
  const id = useId();
  const [value, setValue] = useState(() => utcOffsetDateTimeLocalValue(currentTime, displayUtcOffsetMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minimumValue = utcOffsetDateTimeLocalValue(minimum, displayUtcOffsetMinutes);
  const maximumValue = utcOffsetDateTimeLocalValue(allowForward ? maximum : currentTime, displayUtcOffsetMinutes);
  async function locate(forward: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const time = utcOffsetDateTimeToTimestamp(value, displayUtcOffsetMinutes);
      if (!Number.isFinite(time)) throw new Error(copy.replaySessions.locateInvalid);
      const upperBound = forward ? maximum : currentTime;
      if (time < new Date(minimum).getTime() || time > new Date(upperBound).getTime()) throw new Error(copy.replaySessions.locateOutOfRange);
      if (await onLocate(new Date(time).toISOString(), forward)) onClose();
    } catch (error) { setError(error instanceof Error ? error.message : copy.replaySessions.requestFailed); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} title={copy.replaySessions.locateDate} className="max-w-sm" onClose={() => { if (!busy) onClose(); }}>
    <form className="space-y-4" noValidate aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void locate(false); }}>
      <p id={`${id}-timezone`} className="text-xs text-slate-600">{copy.marketReplay.displayTimezone} · {formatUtcOffset(displayUtcOffsetMinutes)}</p>
      <DateTimePicker value={value} minimum={minimumValue} maximum={maximumValue} disabled={busy} describedBy={`${id}-timezone ${id}-hint${error ? ` ${id}-error` : ""}`} onChange={(next) => { setValue(next); setError(null); }} />
      <p id={`${id}-hint`} className="text-xs text-slate-500">{copy.replaySessions.locateHint}</p>
      <p className="text-xs tabular-nums text-slate-500">{minimumValue.replace("T", " ")} – {maximumValue.replace("T", " ")}</p>
      {allowForward ? <p className="text-xs text-slate-600">{copy.replaySessions.forwardHint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-red-600">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button>
        {allowForward ? <Button type="button" variant="outline" disabled={busy} onClick={() => void locate(true)}>{copy.replaySessions.fastForwardDate}</Button> : null}
        <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{busy ? copy.replaySessions.locatingDate : copy.replaySessions.goToDate}</Button>
      </div>
    </form>
  </Dialog>;
}
