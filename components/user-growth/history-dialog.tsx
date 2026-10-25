"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import type { ProfileSession, UserIdentity } from "@/lib/user-growth/types";

const t = copy.userGrowth;
export function HistoryDialog({ user, sessions, remote, previewControls, confirmationNote = "", onClose, onAssign }: { remote?: { page: number; total: number; loading: boolean; error: string; onRetry: () => void; onQuery: (search: string, mode: string, page: number) => void }; user: UserIdentity; sessions: ProfileSession[]; previewControls?: ReactNode; confirmationNote?: string; onClose: () => void; onAssign: (ids: string[]) => Promise<{ error?: string; removedIds?: string[] }> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("all");
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const onQuery = remote?.onQuery;
  useEffect(() => { onQuery?.(search, mode, page); }, [onQuery, search, mode, page]);
  const available = sessions.filter((s) => !removed.includes(s.id));
  const filtered = remote ? available : available.filter((s) => s.name.includes(search.trim()) && (mode === "all" || s.mode === mode));
  const pages = Math.max(1, Math.ceil((remote?.total ?? filtered.length) / (remote ? 20 : 3)));
  const activePage = Math.min(remote?.page ?? page, pages);
  const commit = async () => {
    if (busy) return; setBusy(true); setError("");
    try {
      const result = await onAssign([...selected]);
      if (result.error) { setError(result.error); setConfirming(false); if (result.removedIds) { setRemoved([...removed, ...result.removedIds]); setSelected(selected.filter((id) => !result.removedIds!.includes(id))); } }
    } finally { setBusy(false); }
  };
  const showList = remote ? remote.loading || !!remote.error || !!error || selected.length > 0 || remote.total > 0 || !!search.trim() || mode !== "all" : available.length > 0;
  return <>
    <Dialog open={!confirming} title={t.assignTitle(user.nickname)} description={t.assignHint} contentClassName="flex flex-col overflow-hidden" onClose={() => { if (!busy) onClose(); }}>
      {showList ? <div className="flex min-h-0 flex-1 flex-col gap-4"><div className="grid shrink-0 grid-cols-[1fr_150px] gap-3"><div className="space-y-2"><Label htmlFor="history-search">{t.assignSearch}</Label><Input id="history-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div><div className="space-y-2"><Label htmlFor="history-mode">{t.filterMode}</Label><Select value={mode} onValueChange={(v) => { setMode(v); setPage(1); }}><SelectTrigger id="history-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t.allModes}</SelectItem><SelectItem value="training">{t.training}</SelectItem><SelectItem value="replay">{t.replay}</SelectItem></SelectContent></Select></div></div>
        <div className="min-h-0 space-y-4 overflow-y-auto">
        {remote?.loading && <p role="status" className="text-sm text-slate-600">{t.loadingHistory}</p>}
        {remote?.error && <p role="alert" className="text-sm text-red-700">{remote.error}<Button variant="outline" className="ml-3" onClick={remote.onRetry}>{t.retry}</Button></p>}
        {filtered.length ? <Table><TableHeader><TableRow><TableHead>{t.sessionName}</TableHead><TableHead>{t.mode}</TableHead><TableHead>{t.account}</TableHead><TableHead className="text-right">{t.trades}</TableHead></TableRow></TableHeader><TableBody>{(remote ? filtered : filtered.slice((activePage - 1) * 3, activePage * 3)).map((s) => <TableRow key={s.id}><TableCell className="min-w-52"><CheckboxField checked={selected.includes(s.id)} onChange={(checked) => setSelected(checked ? [...selected, s.id] : selected.filter((id) => id !== s.id))}>{s.name}</CheckboxField><p className="mt-2 text-xs text-slate-600">{s.market}</p><p className="mt-1 whitespace-nowrap font-mono text-xs text-slate-500">{t.created} · {s.created}</p></TableCell><TableCell className="whitespace-nowrap">{s.mode === "training" ? t.training : t.replay}</TableCell><TableCell className="whitespace-nowrap">{s.account === "prop" ? t.propAccount : t.defaultAccount}</TableCell><TableCell className="text-right tabular-nums">{formatInteger(s.trades)}</TableCell></TableRow>)}</TableBody></Table> : !remote?.loading && !remote?.error ? <p className="border border-dashed p-6 text-sm text-slate-600">{t.historyNoResults}</p> : null}
        {previewControls}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2"><span className="text-sm tabular-nums">{t.page(formatInteger(activePage), formatInteger(pages))}</span><div className="flex gap-2"><Button variant="outline" disabled={remote?.loading || activePage <= 1} onClick={() => setPage(activePage - 1)}>{t.previous}</Button><Button variant="outline" disabled={remote?.loading || activePage >= pages} onClick={() => setPage(activePage + 1)}>{t.next}</Button></div></div>
        {error && <p role="alert" className="max-h-24 shrink-0 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="shrink-0 space-y-3 border-t pt-3"><p role="status" className="break-words text-sm font-medium">{t.selectedSessions(formatInteger(selected.length), user.nickname)}</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t.cancel}</Button><Button disabled={!selected.length || remote?.loading || !!remote?.error} onClick={() => setConfirming(true)}>{t.assignSubmit(formatInteger(selected.length))}</Button></div></div>
      </div> : <div className="space-y-4"><p className="rounded-md border border-dashed p-6 text-sm text-slate-600">{t.historyEmpty}</p><div className="flex justify-end"><Button variant="outline" onClick={onClose}>{t.close}</Button></div></div>}
    </Dialog>
    <ConfirmDialog open={confirming} title={t.assignTitle(user.nickname)} description={`${t.assignConfirm(user.nickname)} ${confirmationNote}`} confirmVariant="default" confirmLabel={t.assignSubmit(formatInteger(selected.length))} isLoading={busy} onCancel={() => setConfirming(false)} onConfirm={commit} />
  </>;
}
