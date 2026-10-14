"use client";

import { useId } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import { copy } from "@/lib/i18n";

type RenameDialogProps = {
  open: boolean; title: string; description?: string; label: string;
  value: string; maxLength: number; placeholder?: string;
  error?: string | null; isLoading?: boolean; confirmLabel: string;
  onChange: (value: string) => void; onCancel: () => void; onConfirm: () => void;
};

export function RenameDialog({ open, title, description, label, value, maxLength, placeholder, error, isLoading = false, confirmLabel, onChange, onCancel, onConfirm }: RenameDialogProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  return <Dialog open={open} title={title} description={description} className="max-w-md" onClose={() => { if (!isLoading) onCancel(); }}>
    <form className="space-y-4" aria-busy={isLoading} onSubmit={(event) => { event.preventDefault(); if (!isLoading) onConfirm(); }}>
      <div className="space-y-2">
        <Label htmlFor={inputId}>{label}</Label>
        <Input id={inputId} value={value} maxLength={maxLength} placeholder={placeholder} disabled={isLoading} autoFocus
          onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
        {error ? <p id={errorId} className="text-xs text-red-600" role="alert">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={isLoading} onClick={onCancel}>{copy.common.cancel}</Button>
        <Button type="submit" disabled={isLoading || !value.trim()}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{confirmLabel}
        </Button>
      </div>
    </form>
  </Dialog>;
}
