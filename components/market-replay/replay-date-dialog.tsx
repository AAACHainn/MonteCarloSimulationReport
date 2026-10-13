"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { dateTimeLocalValue, selectedTimeToTimestamp } from "@/lib/market-replay/start-time";

export function ReplayDateDialog({ open, currentTime, minimum, maximum, timezone, allowForward, onClose, onLocate }: {
  open: boolean; currentTime: string; minimum: string; maximum: string; timezone: string; allowForward: boolean;
  onClose: () => void; onLocate: (timestamp: string, forward: boolean) => Promise<boolean>;
}) {
  const [value, setValue] = useState(() => dateTimeLocalValue(currentTime, timezone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function locate(forward: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const time = selectedTimeToTimestamp(value, timezone);
      if (!Number.isFinite(time)) throw new Error(copy.replaySessions.correctionInvalid);
      if (await onLocate(new Date(time).toISOString(), forward)) onClose();
    } catch (error) { setError(error instanceof Error ? error.message : copy.replaySessions.requestFailed); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} title={copy.replaySessions.locateDate} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4">
      <div className="space-y-2"><Label htmlFor="replay-locate-time">{copy.replaySessions.locateTime} · {timezone}</Label>
        <Input id="replay-locate-time" type="datetime-local" step="1" value={value} min={dateTimeLocalValue(minimum, timezone)} max={dateTimeLocalValue(maximum, timezone)} disabled={busy} onChange={(event) => setValue(event.target.value)} /></div>
      <p className="text-xs text-slate-600">{copy.replaySessions.viewingPast}</p>
      {allowForward ? <p className="text-xs text-slate-600">{copy.replaySessions.forwardHint}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void locate(false)}>{copy.replaySessions.viewPast}</Button>
        {allowForward ? <Button disabled={busy} onClick={() => void locate(true)}>{copy.replaySessions.fastForwardDate}</Button> : null}</div>
    </div>
  </Dialog>;
}
