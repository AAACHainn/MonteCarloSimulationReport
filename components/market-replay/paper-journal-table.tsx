"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { copy } from "@/lib/i18n";
import { formatInterval } from "@/lib/market-replay/types";
import { utcDateParts } from "@/lib/market-replay/display-timezone";
import type { ReplayJournalEntryData } from "@/lib/paper-trading/types";

type JournalSessionSummary = {
  id: string;
  replayGeneration: number;
  initialCapital: number;
  currency: string;
  archivedAt: string | null;
  createdAt: string;
  entryCount: number;
};

type Payload = {
  items: ReplayJournalEntryData[];
  sessions: JournalSessionSummary[];
  nextCursor: number | null;
};

function number(value: number | null, digits = 8) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

function ratio(value: number | null) {
  return number(value, 2);
}

function date(entry: ReplayJournalEntryData) {
  const parts = utcDateParts(entry.openedAt, entry.displayUtcOffsetMinutes);
  return `${parts.year}/${parts.month}/${parts.day}`;
}

export function PaperJournalTable({
  datasetId,
  scope,
  onFocus,
}: {
  datasetId: string;
  scope: "current" | "history";
  onFocus?: (entry: ReplayJournalEntryData) => void;
}) {
  const [items, setItems] = useState<ReplayJournalEntryData[]>([]);
  const [sessions, setSessions] = useState<JournalSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (cursor = 0, append = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal?scope=${scope}&cursor=${cursor}&take=100`);
      const data = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.journalLoadFailed);
      setItems((current) => append ? [...current, ...data.items] : data.items);
      setSessions(data.sessions);
      setNextCursor(data.nextCursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.paperTrading.journalLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [datasetId, scope]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    if (scope === "current") return [{ session: null, entries: items }];
    return sessions.map((session) => ({
      session,
      entries: items.filter((entry) => entry.journalSessionId === session.id),
    })).filter((group) => group.entries.length > 0);
  }, [items, scope, sessions]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal/sessions/${deleteTarget}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.journalDeleteFailed);
      setDeleteTarget(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.paperTrading.journalDeleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  if (loading && items.length === 0) return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{copy.paperTrading.journalLoading}</div>;
  if (error && items.length === 0) return <p className="py-6 text-sm text-red-600">{error}</p>;
  if (items.length === 0) return <p className="py-6 text-sm text-slate-500">{copy.paperTrading.noJournalEntries}</p>;

  return <div className="space-y-5">
    {error ? <p className="text-sm text-red-600">{error}</p> : null}
    {groups.map((group, index) => <section key={group.session?.id ?? `current-${index}`} className="space-y-2">
      {group.session ? <div className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-800">{copy.paperTrading.journalSession(group.session.replayGeneration)}</span>
        <span>{new Date(group.session.createdAt).toLocaleString("zh-CN")}</span>
        <span>{group.session.entryCount} {copy.paperTrading.journalRows}</span>
        <span>{group.session.archivedAt ? copy.paperTrading.journalArchived : copy.paperTrading.journalCurrent}</span>
        {group.session.archivedAt ? <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-red-600" onClick={() => setDeleteTarget(group.session!.id)}><Trash2 className="h-3.5 w-3.5" />{copy.paperTrading.deleteJournalSession}</Button> : null}
      </div> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[1320px] border-collapse text-right text-sm tabular-nums">
          <thead className="bg-blue-50 text-xs text-slate-700"><tr>
            {["No", "Date", "Direction", "ABR", "iRisk", "iRisk / ABR", "aRisk", "aRisk / ABR", "Gain / Loss", "Result", "ABR RR", "iRisk RR", "aRisk RR"].map((label) => <th key={label} className="border-b border-r px-3 py-2 font-semibold last:border-r-0">{label}</th>)}
          </tr></thead>
          <tbody>{group.entries.map((entry) => <tr key={entry.id} className="border-b last:border-b-0 hover:bg-slate-50">
            <td className="border-r px-3 py-2"><button type="button" className="cursor-pointer font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => onFocus ? onFocus(entry) : window.location.assign(`/market-replay/${datasetId}?focusSequence=${entry.openedSequence}&journalNo=${entry.globalNo}`)}>{entry.no}</button></td>
            <td className="border-r px-3 py-2">{date(entry)}</td>
            <td className="border-r px-3 py-2">{entry.direction === "LONG" ? copy.paperTrading.long : copy.paperTrading.short}</td>
            <td className="border-r px-3 py-2" title={`${formatInterval(entry.displayIntervalSeconds)} · ABR(${entry.abrLength})`}>{number(entry.abrValue)}</td>
            <td className="border-r px-3 py-2">{number(entry.initialRisk)}</td>
            <td className="border-r px-3 py-2">{ratio(entry.initialRiskAbr)}</td>
            <td className="border-r px-3 py-2">{number(entry.actualRisk)}</td>
            <td className="border-r px-3 py-2">{ratio(entry.actualRiskAbr)}</td>
            <td className={`border-r px-3 py-2 font-medium ${entry.gainLoss > 0 ? "text-emerald-700" : entry.gainLoss < 0 ? "text-red-700" : ""}`}>{number(entry.gainLoss)}</td>
            <td className="border-r px-3 py-2">{entry.result}</td>
            <td className="border-r px-3 py-2">{ratio(entry.abrRr)}</td>
            <td className="border-r px-3 py-2">{ratio(entry.initialRiskRr)}</td>
            <td className="px-3 py-2">{ratio(entry.actualRiskRr)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>)}
    {nextCursor !== null ? <div className="text-center"><Button type="button" variant="outline" disabled={loading} onClick={() => void load(nextCursor, true)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.paperTrading.loadMoreJournal}</Button></div> : null}
    <ConfirmDialog open={deleteTarget !== null} title={copy.paperTrading.deleteJournalSessionTitle} description={copy.paperTrading.deleteJournalSessionConfirm} isLoading={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
  </div>;
}
