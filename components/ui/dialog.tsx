"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/i18n";

import { useDialogLifecycle } from "@/components/ui/use-dialog-lifecycle";
import { DialogResizeFrame } from "@/components/ui/dialog-resize-frame";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  resizable?: boolean;
  widthStorageKey?: string;
  heightStorageKey?: string;
  onClose: () => void;
};

export function Dialog({ open, title, description, children, className, contentClassName, resizable = false, widthStorageKey, heightStorageKey, onClose }: DialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const { mounted, titleId, descriptionId } = useDialogLifecycle(open, panelRef, onClose);

  if (!open || !mounted) return null;

  const panel = (
      <section
        ref={resizable ? undefined : panelRef}
        tabIndex={resizable ? undefined : -1}
        role={resizable ? undefined : "dialog"}
        aria-modal={resizable ? undefined : true}
        aria-labelledby={resizable ? undefined : titleId}
        aria-describedby={!resizable && description ? descriptionId : undefined}
        className={cn("flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-white shadow-2xl", resizable && "h-full max-w-none", className)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header
          data-dialog-drag-handle={resizable ? "" : undefined}
          role={resizable ? "group" : undefined}
          tabIndex={resizable ? 0 : undefined}
          aria-label={resizable ? copy.common.moveDialogHint : undefined}
          title={resizable ? copy.common.moveDialogHint : undefined}
          className={cn("flex shrink-0 items-start gap-3 border-b px-5 py-4", resizable && "cursor-move touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
        >
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-slate-950">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm text-slate-600">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", contentClassName)}>{children}</div>
      </section>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      {resizable ? <DialogResizeFrame ref={panelRef} titleId={titleId} descriptionId={description ? descriptionId : undefined} widthStorageKey={widthStorageKey} heightStorageKey={heightStorageKey}>
        {panel}
      </DialogResizeFrame> : panel}
    </div>,
    document.body,
  );
}
