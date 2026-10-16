"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/i18n";

import { useDialogLifecycle } from "@/components/ui/use-dialog-lifecycle";
import { DialogResizeFrame } from "@/components/ui/dialog-resize-frame";
import { Button } from "@/components/ui/button";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  modal?: boolean;
  keepMounted?: boolean;
  movable?: boolean;
  resizable?: boolean;
  widthStorageKey?: string;
  heightStorageKey?: string;
  headerActions?: ReactNode;
  layerClassName?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  onClose: () => void;
};

export function Dialog({ open, title, description, children, className, contentClassName, modal = true, keepMounted = false, movable = false, resizable = false, widthStorageKey, heightStorageKey, headerActions, layerClassName, defaultWidth, defaultHeight, onClose }: DialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const framed = movable || resizable;
  const { mounted, titleId, descriptionId } = useDialogLifecycle(open, panelRef, onClose, { modal });

  if ((!open && !keepMounted) || !mounted) return null;

  const panel = (
      <section
        ref={framed ? undefined : panelRef}
        tabIndex={framed ? undefined : -1}
        role={framed ? undefined : "dialog"}
        aria-modal={framed ? undefined : modal}
        aria-labelledby={framed ? undefined : titleId}
        aria-describedby={!framed && description ? descriptionId : undefined}
        className={cn("pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-white shadow-2xl", framed && "h-full max-w-none", className)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header
          data-dialog-drag-handle={framed ? "" : undefined}
          role={framed ? "group" : undefined}
          tabIndex={framed ? 0 : undefined}
          aria-label={framed ? copy.common.moveDialogHint : undefined}
          title={framed ? copy.common.moveDialogHint : undefined}
          className={cn("flex shrink-0 items-start gap-3 border-b px-5 py-4", framed && "cursor-move touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
        >
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="break-words text-lg font-semibold text-slate-950">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm text-slate-600">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <Button type="button" size="icon" variant="ghost" onClick={onClose} className="text-slate-500" aria-label={copy.common.close}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", contentClassName)}>{children}</div>
      </section>
  );

  return createPortal(
    <div aria-hidden={!open || undefined} className={cn("fixed inset-0 z-50 flex items-center justify-center p-4", layerClassName, modal ? "bg-slate-950/35 backdrop-blur-sm" : "pointer-events-none", !open && "hidden")} onMouseDown={modal ? onClose : undefined}>
      {framed ? <DialogResizeFrame ref={panelRef} modal={modal} resizable={resizable} titleId={titleId} descriptionId={description ? descriptionId : undefined} widthStorageKey={widthStorageKey} heightStorageKey={heightStorageKey} defaultWidth={defaultWidth} defaultHeight={defaultHeight}>
        {panel}
      </DialogResizeFrame> : panel}
    </div>,
    document.body,
  );
}
