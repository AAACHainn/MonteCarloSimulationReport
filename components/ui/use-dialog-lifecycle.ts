"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";

const dialogStack: string[] = [];
let bodyOverflowBeforeDialogs = "";
let modalCount = 0;

/** Share portal readiness, focus and scroll locking between dialogs and confirmation dialogs. */
export function useDialogLifecycle(open: boolean, panelRef: RefObject<HTMLElement | null>, onClose: () => void, { modal = true }: { modal?: boolean } = {}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || !mounted) return;
    if (modal) {
      if (modalCount === 0) {
        bodyOverflowBeforeDialogs = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      modalCount += 1;
    }
    dialogStack.push(titleId);
    const isTopDialog = () => dialogStack.at(-1) === titleId;
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') ?? [])]
      .filter((element) => element.getClientRects().length > 0);
    const timer = window.setTimeout(() => {
      if (isTopDialog()) {
        const controls = focusable();
        (controls.find(element => element.hasAttribute("data-dialog-initial-focus"))
          ?? controls.find(element => element.tagName === "INPUT") ?? controls[0] ?? panel)?.focus();
      }
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog() || event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") onCloseRef.current();
      if (modal && event.key === "Tab") {
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
      const restoreFocus = modal || panel?.contains(document.activeElement) || document.activeElement === document.body;
      const index = dialogStack.lastIndexOf(titleId);
      if (index >= 0) dialogStack.splice(index, 1);
      if (modal && --modalCount === 0) document.body.style.overflow = bodyOverflowBeforeDialogs;
      if (wasTopDialog && restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, titleId, mounted, panelRef, modal]);


  return { mounted, titleId, descriptionId };
}
