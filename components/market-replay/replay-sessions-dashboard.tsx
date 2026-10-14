"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Plus } from "lucide-react";
import { ReplayStartDialog } from "./replay-start-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { dateTimeLocalValue, selectedTimeToTimestamp } from "@/lib/market-replay/start-time";
import type { MarketDatasetSummary } from "@/lib/market-replay/types";
import type { ReplaySessionSummary, ReplaySessionMode } from "@/lib/replay-sessions/types";

const t = copy.replaySessions;
export function ReplaySessionsDashboard({ dataset, initialSessions, initialCreateOpen = false }: { dataset: MarketDatasetSummary; initialSessions: ReplaySessionSummary[]; initialCreateOpen?: boolean }) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [name, setName] = useState(t.training as string);
  const [mode, setMode] = useState<ReplaySessionMode>("TRAINING");
  const [start, setStart] = useState(() => dateTimeLocalValue(dataset.startTime, dataset.timezone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ReplaySessionSummary | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const timestamp = selectedTimeToTimestamp(start, dataset.timezone);
      if (!Number.isFinite(timestamp)) throw new Error(t.invalid);
      const response = await fetch(`/api/market-datasets/${dataset.id}/replay-sessions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode, timestamp: new Date(timestamp).toISOString(), playbackRate: 1,
          displayIntervalSeconds: dataset.sourceIntervalSeconds, displaySession: "ETH" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t.requestFailed);
      router.push(`/market-replay/${dataset.id}?sessionId=${encodeURIComponent(data.session.id)}`);
    } catch (error) { setError(error instanceof Error ? error.message : t.requestFailed); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!archiveTarget || busy) return;
    setBusy(true); setError(null);
    try {
      const currentResponse = await fetch(`/api/replay-sessions/${encodeURIComponent(archiveTarget.id)}`, { cache: "no-store" });
      const current = await currentResponse.json();
      if (!currentResponse.ok) throw new Error(current.error ?? t.requestFailed);
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(archiveTarget.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.session.version, status: "ARCHIVED" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t.requestFailed);
      const refreshed = await fetch(`/api/market-datasets/${dataset.id}/replay-sessions`, { cache: "no-store" });
      const result = await refreshed.json();
      if (!refreshed.ok) throw new Error(result.error ?? t.requestFailed);
      setSessions(result.sessions); setArchiveTarget(null);
    } catch (error) { setError(error instanceof Error ? error.message : t.requestFailed); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-slate-600">{t.source}</p>
      <Button onClick={() => { setError(null); setCreateOpen(true); }} disabled={!dataset.sourceIntervalSeconds}><Plus className="h-4 w-4" />{t.create}</Button>
    </div>
    {error && !createOpen ? <Alert className="border-red-200 bg-red-50" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>{t.title}</CardTitle></CardHeader><CardContent>
      {sessions.length ? <Table><TableHeader><TableRow>
        <TableHead>{t.name}</TableHead><TableHead>{t.mode}</TableHead><TableHead>{t.progress}</TableHead>
        <TableHead className="text-right">{t.entries}</TableHead><TableHead />
      </TableRow></TableHeader><TableBody>{sessions.map((session) => <TableRow key={session.id}>
        <TableCell><div className="font-medium">{session.name}</div><Badge className="mt-1">{session.status === "ACTIVE" ? t.active : t.archived}</Badge></TableCell>
        <TableCell>{session.mode === "TRAINING" ? t.training : t.liveReplay}</TableCell>
        <TableCell className="tabular-nums">{session.progress ? formatNumber(Math.max(0, session.progress.currentSequence - session.progress.startSequence + 1)) : copy.common.dash}</TableCell>
        <TableCell className="text-right tabular-nums">{formatNumber(session.entryCount)}</TableCell>
        <TableCell><div className="flex justify-end gap-2">
          <Button asChild variant="outline" size="sm"><Link href={`/market-replay/${dataset.id}?sessionId=${encodeURIComponent(session.id)}`}>{session.status === "ACTIVE" ? t.continue : t.view}</Link></Button>
          {session.status === "ACTIVE" ? <Button variant="ghost" size="sm" onClick={() => setArchiveTarget(session)} disabled={busy || Boolean(session.pendingCorrectionId)}><Archive className="h-4 w-4" />{t.archive}</Button> : null}
        </div></TableCell>
      </TableRow>)}</TableBody></Table> : <div className="rounded-md border border-dashed p-6 text-sm text-slate-600">{t.empty}</div>}
    </CardContent></Card>
    <ReplayStartDialog open={createOpen} title={t.create} description={t.createDescription} confirmLabel={t.create} value={start}
      minimum={dateTimeLocalValue(dataset.startTime, dataset.timezone)} maximum={dateTimeLocalValue(dataset.endTime, dataset.timezone)}
      timezone={dataset.timezone} busy={busy} error={error} onChange={setStart} onCancel={() => setCreateOpen(false)} onConfirm={() => void create()}>
      <div className="space-y-2"><Label htmlFor="replay-session-name">{t.name}</Label><Input id="replay-session-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
      <div className="space-y-2"><Label htmlFor="replay-session-mode">{t.mode}</Label><Select value={mode} disabled={busy} onValueChange={(value) => setMode(value as ReplaySessionMode)}>
        <SelectTrigger id="replay-session-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TRAINING">{t.training}</SelectItem><SelectItem value="LIVE_REPLAY">{t.liveReplay}</SelectItem></SelectContent>
      </Select></div>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
    </ReplayStartDialog>
    <ConfirmDialog open={Boolean(archiveTarget)} title={t.archiveTitle} description={`${archiveTarget?.name ?? ""}：${t.archiveDescription}`}
      confirmLabel={t.archive} confirmVariant="default" isLoading={busy} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archive()} />
  </div>;
}
