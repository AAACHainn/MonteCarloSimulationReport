"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const dialogStack: string[] = [];
let bodyOverflowBeforeDialogs = "";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  onClose: () => void;
};

export function Dialog({ open, title, description, children, className, contentClassName, onClose }: DialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || !mounted) return;
    if (dialogStack.length === 0) {
      bodyOverflowBeforeDialogs = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogStack.push(titleId);
    const isTopDialog = () => dialogStack.at(-1) === titleId;
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') ?? [])]
      .filter((element) => element.getClientRects().length > 0);
    const timer = window.setTimeout(() => {
      if (isTopDialog()) (focusable().find((element) => element.tagName === "INPUT") ?? focusable()[0] ?? panel)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return;
      if (event.key === "Escape") onCloseRef.current();
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0]; const last = elements.at(-1);
        if (!first) { event.preventDefault(); panel?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      const wasTopDialog = isTopDialog();
      const index = dialogStack.lastIndexOf(titleId);
      if (index >= 0) dialogStack.splice(index, 1);
      if (dialogStack.length === 0) document.body.style.overflow = bodyOverflowBeforeDialogs;
      if (wasTopDialog && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, titleId, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn("flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-white shadow-2xl", className)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b px-5 py-4">
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
    </div>,
    document.body,
  );
}
