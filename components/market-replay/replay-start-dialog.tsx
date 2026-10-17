"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateTimePicker, type DateTimePickerHandle } from "@/components/ui/date-time-picker";
import { copy } from "@/lib/i18n";

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
  onConfirm: (value: string) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  children?: ReactNode;
}) {
  const pickerRef = useRef<DateTimePickerHandle>(null);
  return (
    <Dialog
      open={open}
      title={title ?? copy.marketReplay.selectReplayDate}
      description={description ?? copy.marketReplay.selectReplayDateDescription}
      className="max-w-sm"
      onClose={() => { if (!busy) onCancel(); }}
    >
      <form className="space-y-4" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const selected = pickerRef.current?.validate();
        if (selected) onConfirm(selected);
      }}>
        {children}
        <DateTimePicker ref={pickerRef} value={value} minimum={minimum} maximum={maximum} disabled={busy} onChange={onChange} />

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
          <Button type="submit" disabled={busy}>{busy ? copy.marketReplay.selectingReplayDate : confirmLabel ?? copy.marketReplay.selectReplayDateConfirm}</Button>
        </div>
      </form>
    </Dialog>
  );
}
