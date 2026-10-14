"use client";

import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { copy } from "@/lib/i18n";

function clampDateTime(value: string, minimum: string, maximum: string) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

export function ReplayStartDialog({
  open,
  value,
  minimum,
  maximum,
  timezone,
  busy,
  error,
  onChange,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  children,
}: {
  open: boolean;
  value: string;
  minimum: string;
  maximum: string;
  timezone: string;
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      title={title ?? copy.marketReplay.selectReplayDate}
      description={description ?? copy.marketReplay.selectReplayDateDescription}
      className="max-w-sm"
      onClose={() => { if (!busy) onCancel(); }}
    >
      <div className="space-y-4">
        {children}
        <DateTimePicker value={value} minimum={minimum} maximum={maximum} disabled={busy} onChange={(next) => onChange(clampDateTime(next, minimum, maximum))} />

        <Button
          type="button"
          variant="secondary"
          className="mx-auto flex"
          disabled={busy}
          onClick={() => onChange(minimum)}
        >
          {copy.marketReplay.firstAvailableDate}
        </Button>
        <p className="text-center text-xs text-slate-500">{timezone} · {minimum.replace("T", " ")} – {maximum.replace("T", " ")}</p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{copy.common.cancel}</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>{busy ? copy.marketReplay.selectingReplayDate : confirmLabel ?? copy.marketReplay.selectReplayDateConfirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}
