"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, type ReactNode } from "react";
import { DrawingHistory } from "@/lib/market-replay/drawing-history";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { useAiPageScope } from "@/components/ai/page-context";

const Context = createContext<ReplaySessionSummary | null>(null);
const DrawingHistoryContext = createContext<DrawingHistory | null>(null);
export const useDrawingHistory = () => useContext(DrawingHistoryContext);
export function ReplaySessionProvider({ session, children, includeCurrentChart = false }: { session: ReplaySessionSummary; children: ReactNode; includeCurrentChart?: boolean }) {
  const drawingHistory = useMemo(() => new DrawingHistory(`${session.id}:${session.activeProjectionId}`), [session.id, session.activeProjectionId]);
  const register = useAiPageScope()?.register, owner = useId();
  useEffect(() => {
    register?.("page", owner, { replaySessionId: session.id, projectionId: session.activeProjectionId, sessionName: session.name, includeCurrentChart });
    return () => register?.("page", owner, null);
  }, [register, owner, session.id, session.activeProjectionId, session.name, includeCurrentChart]);
  return <Context.Provider value={session}><DrawingHistoryContext.Provider value={drawingHistory}>{children}</DrawingHistoryContext.Provider></Context.Provider>;
}
export const useReplaySession = () => useContext(Context);

export function replaySessionUrl(url: string, replaySessionId?: string, propRoundNumber?: number) {
  if (!replaySessionId || !/^\/api\/market-datasets\/[^/]+\/(progress|paper-session|paper-journal|replay|drawings)(\/|\?|$)/.test(url)) return url;
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set("replaySessionId", replaySessionId);
  if (propRoundNumber !== undefined) parsed.searchParams.set("propRound", String(propRoundNumber));
  return parsed.pathname + parsed.search;
}
export function useReplaySessionUrl() {
  const session = useReplaySession();
  return useCallback((url: string) => replaySessionUrl(url, session?.id, session?.propRoundNumber), [session]);
}
export function useReplayFetch(): typeof fetch {
  const session = useReplaySession();
  const drawingHistory = useDrawingHistory();
  return useCallback((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? replaySessionUrl(input, session?.id, session?.propRoundNumber) : input;
    const headers = new Headers(init?.headers);
    if (session && typeof url === "string" && url.includes("replaySessionId=")) {
      headers.set("X-Replay-Projection", session.activeProjectionId);
    }
    return drawingHistory ? drawingHistory.observe(globalThis.fetch, url, { ...init, headers }) : globalThis.fetch(url, { ...init, headers });
  }, [session, drawingHistory]);
}
