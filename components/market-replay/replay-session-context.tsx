"use client";

import { createContext, useCallback, useContext, useEffect, useId, type ReactNode } from "react";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { useAiPageScope } from "@/components/ai/page-context";

const Context = createContext<ReplaySessionSummary | null>(null);
export function ReplaySessionProvider({ session, children, includeCurrentChart = false }: { session: ReplaySessionSummary; children: ReactNode; includeCurrentChart?: boolean }) {
  const register = useAiPageScope()?.register, owner = useId();
  useEffect(() => {
    register?.("page", owner, { replaySessionId: session.id, projectionId: session.activeProjectionId, sessionName: session.name, includeCurrentChart });
    return () => register?.("page", owner, null);
  }, [register, owner, session.id, session.activeProjectionId, session.name, includeCurrentChart]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export const useReplaySession = () => useContext(Context);

export function replaySessionUrl(url: string, replaySessionId?: string) {
  if (!replaySessionId || !/^\/api\/market-datasets\/[^/]+\/(progress|paper-session|paper-journal|replay|drawings)(\/|\?|$)/.test(url)) return url;
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set("replaySessionId", replaySessionId);
  return parsed.pathname + parsed.search;
}
export function useReplaySessionUrl() {
  const session = useReplaySession();
  return useCallback((url: string) => replaySessionUrl(url, session?.id), [session]);
}
export function useReplayFetch(): typeof fetch {
  const session = useReplaySession();
  return useCallback((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? replaySessionUrl(input, session?.id) : input;
    const headers = new Headers(init?.headers);
    if (session && typeof url === "string" && url.includes("replaySessionId=")) {
      headers.set("X-Replay-Projection", session.activeProjectionId);
    }
    return globalThis.fetch(url, { ...init, headers });
  }, [session]);
}
