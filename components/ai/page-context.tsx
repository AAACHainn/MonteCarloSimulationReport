"use client";
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { z } from "zod";
import type { pageChartWindowSchema } from "@/lib/ai/schema";

export type AiPageScope = {
  replaySessionId: string; projectionId: string; sessionName: string;
  entryId?: string; entryNo?: number; draft?: string; templateId?: string; includeCurrentChart?: boolean;
  chartWindow?: z.infer<typeof pageChartWindowSchema>;
};
type Registration = { owner: string; value: AiPageScope };
const PageContext = createContext<{
  page: AiPageScope | null; selection: AiPageScope | null;
  register: (kind: "page" | "selection" | "chart", owner: string, value: AiPageScope | null) => void;
} | null>(null);
export function AiPageScopeProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<Registration | null>(null), [selection, setSelection] = useState<Registration | null>(null);
  const [chart, setChart] = useState<Registration | null>(null);
  const register = useCallback((kind: "page" | "selection" | "chart", owner: string, value: AiPageScope | null) => {
    (kind === "page" ? setPage : kind === "chart" ? setChart : setSelection)((current) => value ? { owner, value } : current?.owner === owner ? null : current);
  }, []);
  const value = useMemo(() => ({ page: chart?.value.replaySessionId === page?.value.replaySessionId && chart?.value.projectionId === page?.value.projectionId ? chart?.value ?? page?.value ?? null : page?.value ?? null,
    selection: selection?.value.replaySessionId === page?.value.replaySessionId && selection?.value.projectionId === page?.value.projectionId ? selection?.value ?? null : null, register }), [page, selection, chart, register]);
  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}
export const useAiPageScope = () => useContext(PageContext);
