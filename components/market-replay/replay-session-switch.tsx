"use client";

import { useReplaySessionEntry } from "./replay-session-entry-guard";
import { useCurrentUser } from "@/components/user-growth/user-context";
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
  const selectedUser = useCurrentUser();
  const router = useRouter();
  const entry = useReplaySessionEntry();
  const [sessions, setSessions] = useState<ReplaySessionSummary[]>(current ? [current] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    void fetch(`/api/market-datasets/${current.datasetId}/replay-sessions${selectedUser.selectedId ? `?userId=${encodeURIComponent(selectedUser.selectedId)}` : ""}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
      if (!controller.signal.aborted) setSessions(data.sessions);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : copy.replaySessions.requestFailed); });
    return () => controller.abort();
  }, [current, selectedUser.selectedId]);
  if (!current) return null;
  async function navigate(id?: string) {
    if (!current || busy || entry.busy || id === current.id) return;
    if (id) { await entry.open({ sessionId: id, beforeEnter: beforeSwitch }); return; }
    setBusy(true); setError(null);
    try {
      if (!await beforeSwitch()) throw new Error(copy.replaySessions.switchFailed);
      router.push(`/market-replay/${current.datasetId}${id ? `?sessionId=${encodeURIComponent(id)}` : ""}`);
    } catch (error) { setError(error instanceof Error ? error.message : copy.replaySessions.switchFailed); setBusy(false); }
  }
  const visibleSessions = [current, ...sessions.filter(session => session.id !== current.id && (!selectedUser.selectedId || session.userId === selectedUser.selectedId))];
  return <div className="flex min-w-0 flex-wrap items-center gap-2" aria-busy={busy}>
    <Badge className={current.mode === "TRAINING" ? "border-blue-200 bg-blue-50 text-blue-700" : undefined}>{current.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay}</Badge>
    <div className="border-l border-slate-200 pl-2">
      <Select value={current.id} disabled={busy || entry.busy || disabled} onValueChange={(id) => void navigate(id)}>
        <SelectTrigger aria-label={copy.replaySessions.switch} className="h-8 w-56 [&>span]:truncate [&>span]:whitespace-nowrap"><SelectValue /></SelectTrigger>
        <SelectContent>{visibleSessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.name} · {session.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <Button size="sm" variant="ghost" onClick={() => void navigate()} disabled={busy || entry.busy || disabled}><List className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.allSessions}</Button>
    <span className="whitespace-nowrap text-xs text-slate-500">{busy ? copy.replaySessions.switching : copy.replaySessions.source}</span>
    {entry.ui}
    {error ? <span role="alert" className="max-w-lg text-xs text-red-600">{error}</span> : null}
  </div>;
}
