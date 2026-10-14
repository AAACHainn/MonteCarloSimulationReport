"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { List } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useReplaySession } from "./replay-session-context";
import { copy } from "@/lib/i18n";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";

export function ReplaySessionSwitch({ beforeSwitch, disabled = false }: { beforeSwitch: () => Promise<boolean>; disabled?: boolean }) {
  const current = useReplaySession();
  const router = useRouter();
  const [sessions, setSessions] = useState<ReplaySessionSummary[]>(current ? [current] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    void fetch(`/api/market-datasets/${current.datasetId}/replay-sessions`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
      setSessions(data.sessions);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : copy.replaySessions.requestFailed); });
    return () => controller.abort();
  }, [current]);
  if (!current) return null;
  async function navigate(id?: string) {
    if (!current || busy || id === current.id) return;
    setBusy(true); setError(null);
    try {
      if (!await beforeSwitch()) throw new Error(copy.replaySessions.switchFailed);
      router.push(`/market-replay/${current.datasetId}${id ? `?sessionId=${encodeURIComponent(id)}` : ""}`);
    } catch (error) { setError(error instanceof Error ? error.message : copy.replaySessions.switchFailed); setBusy(false); }
  }
  return <div className="flex min-w-0 items-center gap-2" aria-busy={busy}>
    <Badge>{current.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay}</Badge>
    <Select value={current.id} disabled={busy || disabled} onValueChange={(id) => void navigate(id)}>
      <SelectTrigger aria-label={copy.replaySessions.switch} className="h-8 w-56"><SelectValue /></SelectTrigger>
      <SelectContent>{sessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.name} · {session.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay}</SelectItem>)}</SelectContent>
    </Select>
    <Button size="sm" variant="ghost" onClick={() => void navigate()} disabled={busy || disabled}><List className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.allSessions}</Button>
    <span className="whitespace-nowrap text-xs text-slate-500">{busy ? copy.replaySessions.switching : copy.replaySessions.source}</span>
    {error ? <span role="alert" className="max-w-lg text-xs text-red-600">{error}</span> : null}
  </div>;
}
