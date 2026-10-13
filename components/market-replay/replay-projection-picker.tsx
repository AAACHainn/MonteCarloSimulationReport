"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { useReplaySession } from "./replay-session-context";

export function ReplayProjectionPicker({ baseHref }: { baseHref: string }) {
  const session = useReplaySession();
  const router = useRouter();
  const [projections, setProjections] = useState<{ id: string; generation: number; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}/projections`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
      setProjections(data.projections);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : copy.replaySessions.requestFailed); });
    return () => controller.abort();
  }, [sessionId]);
  if (!session || projections.length < 2 && !error) return null;
  return <div className="flex items-center gap-2">
    <Label htmlFor="replay-result-version">{copy.replaySessions.resultVersion}</Label>
    <Select value={session.activeProjectionId} onValueChange={(id) => {
      const url = new URL(baseHref, "http://localhost"); url.searchParams.set("projectionId", id); router.push(url.pathname + url.search);
    }}><SelectTrigger id="replay-result-version" className="w-52"><SelectValue /></SelectTrigger><SelectContent>
      {projections.map((projection) => <SelectItem key={projection.id} value={projection.id}>{copy.replaySessions.versionLabel(projection.generation, projection.status === "CURRENT")}</SelectItem>)}
    </SelectContent></Select>
    {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
  </div>;
}
