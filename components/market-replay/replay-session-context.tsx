"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";

const Context = createContext<ReplaySessionSummary | null>(null);
export function ReplaySessionProvider({ session, children }: { session: ReplaySessionSummary; children: ReactNode }) {
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export const useReplaySession = () => useContext(Context);

export function replaySessionUrl(url: string, replaySessionId?: string, viewProjectionId?: string) {
  if (!replaySessionId || !/^\/api\/market-datasets\/[^/]+\/(progress|paper-session|paper-journal|replay|drawings)(\/|\?|$)/.test(url)) return url;
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set("replaySessionId", replaySessionId);
  if (viewProjectionId) parsed.searchParams.set("viewProjectionId", viewProjectionId);
  return parsed.pathname + parsed.search;
}
export function useReplaySessionUrl() {
  const session = useReplaySession();
  return useCallback((url: string) => replaySessionUrl(url, session?.id, session?.status === "ARCHIVED" ? session.activeProjectionId : undefined), [session]);
}
export function useReplayFetch(): typeof fetch {
  const session = useReplaySession();
  return useCallback((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? replaySessionUrl(input, session?.id, session?.status === "ARCHIVED" ? session.activeProjectionId : undefined) : input;
    const headers = new Headers(init?.headers);
    if (session && typeof url === "string" && url.includes("replaySessionId=")) {
      headers.set("X-Replay-Projection", session.activeProjectionId);
    }
    return globalThis.fetch(url, { ...init, headers });
  }, [session]);
}
