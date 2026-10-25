"use client";

import { useCurrentUser } from "@/components/user-growth/user-context";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { List, Loader2, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";

export function ReplaySessionEntry({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ReplaySessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!open || !currentUser.hydrated) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void fetch(`/api/market-datasets/${encodeURIComponent(datasetId)}/replay-sessions${currentUser.selectedId ? `?userId=${encodeURIComponent(currentUser.selectedId)}` : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
        if (!controller.signal.aborted) setSessions(data.sessions);
      })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : copy.replaySessions.requestFailed); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [datasetId, open, currentUser.selectedId, currentUser.hydrated]);

  return <>
    <Select open={open} onOpenChange={(value) => { setOpen(value); if (value) { setLoading(true); setError(null); } }} value="" disabled={pending} onValueChange={(id) => {
      startTransition(() => router.push(`/market-replay/${encodeURIComponent(datasetId)}?${id === "__new__" ? "create=1" : `sessionId=${encodeURIComponent(id)}`}`));
    }}>
      <SelectTrigger variant="primary" aria-label={copy.replaySessions.openSession} className="w-auto gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        <SelectValue placeholder={copy.marketReplay.open} />
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="max-h-[min(24rem,var(--radix-select-content-available-height))] w-80 max-w-[calc(100vw-2rem)]">
        {loading ? <SelectItem value="__loading__" disabled>{copy.replaySessions.loadingSessions}</SelectItem>
          : error ? <SelectItem value="__error__" disabled title={error}><span role="alert" className="text-red-600">{copy.replaySessions.openFailed}</span></SelectItem>
          : sessions.length ? [...sessions].sort((a, b) => Number(a.status === "ARCHIVED") - Number(b.status === "ARCHIVED")).map((session) => <SelectItem key={session.id} value={session.id} textValue={session.name} title={session.name}>
            <span className="block max-w-60 truncate font-medium">{session.name}</span>
            <span className="block text-xs text-slate-500">{session.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay} · {session.status === "ACTIVE" ? copy.replaySessions.active : copy.replaySessions.archived}</span>
          </SelectItem>) : <SelectItem value="__empty__" disabled>{copy.replaySessions.noSessions}</SelectItem>}
        <SelectItem value="__new__" disabled={loading} className="mt-1 border-t pt-2"><span className="flex items-center gap-2 text-blue-700"><Plus className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.create}</span></SelectItem>
      </SelectContent>
    </Select>
    <Button asChild variant="outline" size="sm"><Link href={`/market-replay/${encodeURIComponent(datasetId)}`}><List className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.allSessions}</Link></Button>
  </>;
}
