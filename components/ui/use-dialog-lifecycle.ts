"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";

const dialogStack: string[] = [];
let bodyOverflowBeforeDialogs = "";

/** Share portal readiness, focus and scroll locking between dialogs and confirmation dialogs. */
export function useDialogLifecycle(open: boolean, panelRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const titleId = useId();
  const descriptionId = useId();
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
  }, [open, titleId, mounted, panelRef]);


  return { mounted, titleId, descriptionId };
}
