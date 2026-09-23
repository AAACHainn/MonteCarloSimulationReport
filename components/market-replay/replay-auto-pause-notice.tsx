"use client";

import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { copy } from "@/lib/i18n";
import type { ReplayAutoPauseEvent } from "@/lib/market-replay/use-replay-playback";

function reasonText(event: ReplayAutoPauseEvent) {
  if (event.reason === "page-hidden") return copy.marketReplay.pauseReasonHidden;
  if (event.reason === "operation-failed") return copy.marketReplay.pauseReasonOperationFailed;
  if (event.reason === "source-failed") return copy.marketReplay.pauseReasonSourceFailed;
  if (event.reason === "sync-conflict") return copy.marketReplay.pauseReasonSyncConflict;
  return copy.marketReplay.pauseReasonStateMismatch;
}

export function ReplayAutoPauseNotice({
  event,
  onDismiss,
}: {
  event: ReplayAutoPauseEvent;
  onDismiss: () => void;
}) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startTimerWhenVisible = () => {
      if (document.visibilityState !== "visible" || timer) return;
      timer = setTimeout(onDismiss, 5_000);
    };

    startTimerWhenVisible();
    document.addEventListener("visibilitychange", startTimerWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", startTimerWhenVisible);
      if (timer) clearTimeout(timer);
    };
  }, [event.id, onDismiss]);

  const hiddenPause = event.reason === "page-hidden";
  return (
    <div
      className={`pointer-events-auto flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur-sm ${hiddenPause
        ? "border-amber-200 bg-amber-50/95 text-amber-900"
        : "border-red-200 bg-red-50/95 text-red-800"}`}
      role={hiddenPause ? "status" : "alert"}
      aria-live={hiddenPause ? "polite" : "assertive"}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">{copy.marketReplay.autoPauseTitle}</span>
      <span className="min-w-0 flex-1 truncate sm:whitespace-normal">{reasonText(event)}</span>
      <button
        type="button"
        className="shrink-0 rounded-md p-1 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        aria-label={copy.marketReplay.closeAutoPauseNotice}
        onClick={onDismiss}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
