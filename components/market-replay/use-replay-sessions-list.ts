"use client";

import { useEffect, useState } from "react";
import { copy } from "@/lib/i18n";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";

export function useReplaySessionsList(datasetId: string, initialSessions: ReplaySessionSummary[], paused: boolean, userId?: string | null) {
  const [sessions, setSessions] = useState(initialSessions);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => setSessions(initialSessions), [datasetId, initialSessions]);
  useEffect(() => {
    if (paused) return;
    let active = true;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      if (document.visibilityState === "hidden") return;
      const request = new AbortController(); controller = request;
      setLoading(true);
      void (async () => {
        try {
          const response = await fetch(`/api/market-datasets/${encodeURIComponent(datasetId)}/replay-sessions${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`, { cache: "no-store", signal: request.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? copy.replaySessions.requestFailed);
          if (active && !request.signal.aborted) { setSessions(result.sessions); setError(null); }
        } catch (cause) {
          if (active && !request.signal.aborted) setError(cause instanceof Error ? cause.message : copy.replaySessions.requestFailed);
        } finally { if (active && !request.signal.aborted) setLoading(false); }
      })();
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false; controller?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [datasetId, initialSessions, paused, userId]);
  return { sessions, setSessions, error, loading };
}
