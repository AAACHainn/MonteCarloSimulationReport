"use client";

import { useEffect } from "react";
import { hasVisibleReplayDialog } from "@/lib/market-replay/keyboard-shortcuts";

export function useWebFullscreen(active: boolean, exit: () => void, blocked: boolean) {
  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previousOverflow; };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || blocked || hasVisibleReplayDialog()
        || document.querySelector("[role='menu'], [role='listbox'], [data-context-menu], [data-radix-popper-content-wrapper]")) return;
      event.preventDefault();
      exit();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, blocked, exit]);
}
