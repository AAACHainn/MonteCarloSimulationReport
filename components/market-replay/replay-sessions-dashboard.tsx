"use client";

import { useCurrentUser } from "@/components/user-growth/user-context";
import { NewSessionOwner, eligibilityLabel } from "@/components/user-growth/ownership-context";
import { useState } from "react";
import { useReplaySessionEntry } from "./replay-session-entry-guard";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { ReplayStartDialog } from "./replay-start-dialog";
import { useReplaySessionsList } from "./use-replay-sessions-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatNumber, formatMoney } from "@/lib/format";
import { propResultLabel } from "@/lib/prop-practice/result-label";
import { dateTimeLocalValue, selectedTimeToTimestamp } from "@/lib/market-replay/start-time";
import type { MarketDatasetSummary } from "@/lib/market-replay/types";
import type { ReplaySessionSummary, ReplaySessionMode } from "@/lib/replay-sessions/types";

const t = copy.replaySessions;
export function ReplaySessionsDashboard({ dataset, initialSessions, initialCreateOpen = false }: { dataset: MarketDatasetSummary; initialSessions: ReplaySessionSummary[]; initialCreateOpen?: boolean }) {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const entry = useReplaySessionEntry();
  const [submittedOwner, setSubmittedOwner] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [name, setName] = useState(t.training as string);
  const [mode, setMode] = useState<ReplaySessionMode>("TRAINING");
  const [start, setStart] = useState(() => dateTimeLocalValue(dataset.startTime, dataset.timezone));
  const [busy, setBusy] = useState(false);
  const { sessions, setSessions, error: refreshError, loading: sessionsLoading } = useReplaySessionsList(dataset.id, initialSessions, busy, currentUser.selectedId);
  const [error, setError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ReplaySessionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReplaySessionSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ReplaySessionSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function beginRename(session: ReplaySessionSummary) {
    setRenameTarget(session); setRenameDraft(session.name); setRenameError(null); setStatus(null); setError(null);
  }
  async function rename() {
    if (!renameTarget || busy) return;
    const name = renameDraft.trim();
    if (!name || name.length > 100) { setRenameError(name ? t.nameTooLong : t.nameRequired); return; }
    setBusy(true); setRenameError(null);
    try {
      const url = `/api/replay-sessions/${encodeURIComponent(renameTarget.id)}`;
      const currentResponse = await fetch(url, { cache: "no-store" });
      const current = await currentResponse.json();
      if (!currentResponse.ok) throw new Error(current.error ?? t.renameFailed);
      const response = await fetch(url, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.session.version, name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t.renameFailed);
      setSessions((items) => items.map((session) => session.id === renameTarget.id ? { ...current.session, name, version: current.session.version + 1 } : session));
      setRenameTarget(null); setStatus(t.renamed); router.refresh();
    } catch (error) { setRenameError(error instanceof Error ? error.message : t.renameFailed); }
    finally { setBusy(false); }
  }

  async function create(value: string) {
    if (busy || !currentUser.hydrated) return;
    const userId = currentUser.selectedId;
    setSubmittedOwner(currentUser.selected?.nickname ?? copy.userGrowth.unowned);
    setBusy(true); setError(null);
    try {
      const timestamp = selectedTimeToTimestamp(value, dataset.timezone);
      if (!Number.isFinite(timestamp)) throw new Error(t.invalid);
      const response = await fetch(`/api/market-datasets/${dataset.id}/replay-sessions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode, userId, timestamp: new Date(timestamp).toISOString(), playbackRate: 1,
          displayIntervalSeconds: dataset.sourceIntervalSeconds, displaySession: "ETH" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t.requestFailed);
      router.push(`/market-replay/${dataset.id}?sessionId=${encodeURIComponent(data.session.id)}`);
    } catch (error) { setError(error instanceof Error ? error.message : t.requestFailed); }
    finally { setBusy(false); setSubmittedOwner(undefined); }
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
  async function remove() {
    if (!deleteTarget || busy) return;
    setBusy(true); setDeleteError(null);
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: deleteTarget.version }),
      });
      const result = await response.json();
      if (!response.ok) {
        // A concurrent replay or correction requires a refreshed list and a new confirmation.
        if (response.status === 409 || response.status === 404) router.refresh();
        throw new Error(result.error ?? t.deleteFailed);
      }
      setSessions((items) => items.filter((session) => session.id !== deleteTarget.id));
      setDeleteTarget(null); setStatus(t.deleted); router.refresh();
    } catch (error) { setDeleteError(error instanceof Error ? error.message : t.deleteFailed); }
    finally { setBusy(false); }
  }
  const visibleSessions = sessions.filter(session => !currentUser.selectedId || session.userId === currentUser.selectedId);
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-slate-600">{t.source}</p>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/prop-practice-templates">{copy.propPractice.templates}</Link></Button><Button onClick={() => { setError(null); setStatus(null); setCreateOpen(true); }} disabled={busy || !dataset.sourceIntervalSeconds}><Plus className="h-4 w-4" />{t.create}</Button></div>
    </div>
    {sessionsLoading && <p role="status" className="text-sm text-slate-600">{t.loadingSessions}</p>}
    {(error ?? refreshError) && !createOpen ? <Alert className="border-red-200 bg-red-50" role="alert"><AlertDescription>{error ?? refreshError}</AlertDescription></Alert> : null}
    {status ? <Alert className="border-emerald-200 bg-emerald-50" role="status" aria-live="polite"><AlertDescription>{status}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>{t.title}</CardTitle></CardHeader><CardContent>
      {visibleSessions.length ? <Table><TableHeader><TableRow>
        <TableHead>{t.name}</TableHead><TableHead>{t.mode}</TableHead><TableHead>{t.progress}</TableHead>
        <TableHead className="text-right">{t.entries}</TableHead><TableHead />
      </TableRow></TableHeader><TableBody>{visibleSessions.map((session) => <TableRow key={session.id}>
        <TableCell><div className="flex items-center gap-2"><span className="font-medium">{session.name}</span>
          <Button type="button" variant="ghost" size="icon" disabled={busy || Boolean(session.pendingCorrectionId)} aria-label={t.renameLabel(session.name)} title={t.rename}
            onClick={() => beginRename(session)}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
        </div><p className="mt-1 text-xs text-slate-600">{copy.userGrowth.owner}：{session.owner?.nickname ?? copy.userGrowth.unowned} · {eligibilityLabel(session)}</p><Badge className="mt-1">{session.status === "ACTIVE" ? t.active : t.archived}</Badge>
          {session.propAccount ? <div className="mt-1 space-y-1 text-xs text-slate-600"><p>{copy.propPractice.title} · {propResultLabel(session.propAccount.state, session.propAccount.snapshot.currency, formatMoney)}</p><p>{copy.propPractice.totalReceived}: {formatMoney(session.propAccount.state.totalReceived, session.propAccount.snapshot.currency)}</p></div> : null}
          {session.pendingCorrectionId ? <p className="mt-1 text-xs text-slate-600">{t.deleteCorrectionPending}</p> : null}
        </TableCell>
        <TableCell>{session.mode === "TRAINING" ? t.training : t.liveReplay}</TableCell>
        <TableCell className="tabular-nums">{session.progress ? formatNumber(Math.max(0, session.progress.currentSequence - session.progress.startSequence + 1)) : copy.common.dash}</TableCell>
        <TableCell className="text-right tabular-nums">{formatNumber(session.entryCount)}</TableCell>
        <TableCell><div className="flex justify-end gap-2">
          <Button asChild variant="outline" size="sm" disabled={entry.busy}><Link href={`/market-replay/${dataset.id}?sessionId=${encodeURIComponent(session.id)}`} onClick={event => { if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void entry.open({ sessionId: session.id }); }}>{session.status === "ACTIVE" ? t.continue : t.view}</Link></Button>
          {session.status === "ACTIVE" ? <Button variant="ghost" size="sm" onClick={() => { setStatus(null); setArchiveTarget(session); }} disabled={busy || Boolean(session.pendingCorrectionId)}><Archive className="h-4 w-4" />{t.archive}</Button> : null}
          <Button type="button" variant="destructive" size="sm" aria-label={t.deleteLabel(session.name)} disabled={busy || Boolean(session.pendingCorrectionId)}
            onClick={() => { setStatus(null); setError(null); setDeleteError(null); setDeleteTarget(session); }}><Trash2 className="h-4 w-4" aria-hidden="true" />{t.delete}</Button>
        </div></TableCell>
      </TableRow>)}</TableBody></Table> : <div className="rounded-md border border-dashed p-6 text-sm text-slate-600">{copy.userGrowth.emptyScope}</div>}
    </CardContent></Card>
    {entry.ui}
    <ReplayStartDialog open={createOpen} title={t.create} description={t.createDescription} confirmLabel={t.create} value={start}
      minimum={dateTimeLocalValue(dataset.startTime, dataset.timezone)} maximum={dateTimeLocalValue(dataset.endTime, dataset.timezone)}
      timezone={dataset.timezone} busy={busy} error={error} onChange={setStart} onCancel={() => setCreateOpen(false)} onConfirm={(value) => void create(value)}>
      <div className="space-y-2"><Label htmlFor="replay-session-name">{t.name}</Label><Input id="replay-session-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
      <div className="space-y-2"><Label htmlFor="replay-session-mode">{t.mode}</Label><Select value={mode} disabled={busy} onValueChange={(value) => setMode(value as ReplaySessionMode)}>
        <SelectTrigger id="replay-session-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TRAINING">{t.training}</SelectItem><SelectItem value="LIVE_REPLAY">{t.liveReplay}</SelectItem></SelectContent>
      </Select></div>
      <NewSessionOwner submittedName={submittedOwner} />
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
    </ReplayStartDialog>
    <ConfirmDialog open={Boolean(archiveTarget)} title={t.archiveTitle} description={`${archiveTarget?.name ?? ""}：${t.archiveDescription}`}
      confirmLabel={t.archive} confirmVariant="default" isLoading={busy} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archive()} />
    <RenameDialog open={Boolean(renameTarget)} title={t.renameTitle} description={t.renameDescription} label={t.name}
      value={renameDraft} onChange={(value) => { setRenameDraft(value); setRenameError(null); }} maxLength={100}
      error={renameError} isLoading={busy} confirmLabel={t.saveName} onCancel={() => setRenameTarget(null)} onConfirm={() => void rename()} />
    <ConfirmDialog open={Boolean(deleteTarget)} title={t.deleteTitle} description={t.deleteDescription(deleteTarget?.name ?? "")}
      confirmLabel={t.delete} isLoading={busy} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => void remove()} />
  </div>;
}
