"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogLifecycle } from "@/components/ui/use-dialog-lifecycle";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "default" | "destructive";
  secondaryAction?: { label: string; onClick: () => void; variant?: "outline" | "destructive" };
  isLoading?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  layerClassName?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = copy.common.confirm,
  cancelLabel = copy.common.cancel,
  confirmVariant = "destructive",
  secondaryAction,
  isLoading = false,
  confirmDisabled = false,
  error,
  layerClassName,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, titleId, descriptionId } = useDialogLifecycle(open, panelRef, () => {
    if (!isLoading) onCancel();
  });

  if (!open || !mounted) return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm", layerClassName)}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-busy={isLoading}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex min-h-0 items-start gap-3 overflow-y-auto border-b px-5 py-4">
          <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md", confirmVariant === "destructive" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800")}>
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-950">
              {title}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-600">
              {description}
            </p>
            {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-50"
            onClick={onCancel}
            disabled={isLoading}
            aria-label={cancelLabel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 bg-slate-50 px-5 py-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
          {secondaryAction ? <Button type="button" variant={secondaryAction.variant ?? "outline"} onClick={secondaryAction.onClick} disabled={isLoading}>
            {secondaryAction.label}
          </Button> : null}
          <Button type="button" variant={confirmVariant} onClick={onConfirm} disabled={isLoading || confirmDisabled}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
