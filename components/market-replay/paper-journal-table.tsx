"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type TradeOption = {
  id: string;
  type: "INSTRUMENT" | "STRATEGY";
  name: string;
  active: boolean;
};

const noSetupValue = "__NO_SETUP__";

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
  const [setupOptions, setSetupOptions] = useState<TradeOption[]>([]);
  const [setupOptionsLoading, setSetupOptionsLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [savingSetupIds, setSavingSetupIds] = useState<Set<string>>(() => new Set());

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

  useEffect(() => {
    let cancelled = false;
    async function loadSetupOptions() {
      setSetupOptionsLoading(true);
      try {
        const response = await fetch("/api/trade-options");
        const data: unknown = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error(copy.paperTrading.setupLoadFailed);
        if (!cancelled) {
          setSetupOptions((data as TradeOption[]).filter((option) => option.type === "STRATEGY"));
          setSetupError(null);
        }
      } catch {
        if (!cancelled) {
          setSetupError(copy.paperTrading.setupLoadFailed);
        }
      } finally {
        if (!cancelled) setSetupOptionsLoading(false);
      }
    }
    void loadSetupOptions();
    return () => { cancelled = true; };
  }, []);

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

  async function updateSetup(entry: ReplayJournalEntryData, value: string) {
    const setupOptionId = value === noSetupValue ? null : value;
    if (setupOptionId === entry.setupOptionId) return;
    const selectedOption = setupOptions.find((option) => option.id === setupOptionId) ?? null;
    const previousSetup = {
      setupOptionId: entry.setupOptionId,
      setupOption: entry.setupOption,
    };

    setSetupError(null);
    setItems((current) => current.map((item) => item.id === entry.id ? {
      ...item,
      setupOptionId,
      setupOption: selectedOption ? { name: selectedOption.name } : null,
    } : item));
    setSavingSetupIds((current) => new Set(current).add(entry.id));

    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupOptionId }),
      });
      const data = await response.json() as ReplayJournalEntryData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.setupUpdateFailed);
      setItems((current) => current.map((item) => item.id === entry.id ? data : item));
    } catch {
      setItems((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        ...previousSetup,
      } : item));
      setSetupError(copy.paperTrading.setupUpdateFailed);
    } finally {
      setSavingSetupIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  if (loading && items.length === 0) return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{copy.paperTrading.journalLoading}</div>;
  if (error && items.length === 0) return <p className="py-6 text-sm text-red-600">{error}</p>;
  if (items.length === 0) return <p className="py-6 text-sm text-slate-500">{copy.paperTrading.noJournalEntries}</p>;

  return <div className="space-y-5">
    {error ? <p className="text-sm text-red-600">{error}</p> : null}
    {setupError ? <p className="text-sm text-red-600" role="alert">{setupError}</p> : null}
    {groups.map((group, index) => <section key={group.session?.id ?? `current-${index}`} className="space-y-2">
      {group.session ? <div className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-800">{copy.paperTrading.journalSession(group.session.replayGeneration)}</span>
        <span>{new Date(group.session.createdAt).toLocaleString("zh-CN")}</span>
        <span>{group.session.entryCount} {copy.paperTrading.journalRows}</span>
        <span>{group.session.archivedAt ? copy.paperTrading.journalArchived : copy.paperTrading.journalCurrent}</span>
        {group.session.archivedAt ? <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-red-600" onClick={() => setDeleteTarget(group.session!.id)}><Trash2 className="h-3.5 w-3.5" />{copy.paperTrading.deleteJournalSession}</Button> : null}
      </div> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[1540px] border-collapse text-right text-sm tabular-nums">
          <thead className="bg-blue-50 text-xs text-slate-700"><tr>
            {["No", "Date", "Direction", copy.paperTrading.setup, "ABR", "iRisk", "iRisk / ABR", "aRisk", "aRisk / ABR", "Gain / Loss", "Result", "ABR RR", "iRisk RR", "aRisk RR"].map((label) => <th key={label} className={`border-b border-r px-3 py-2 font-semibold last:border-r-0 ${label === copy.paperTrading.setup ? "w-52 min-w-52 max-w-52 text-left" : ""}`}>{label}</th>)}
          </tr></thead>
          <tbody>{group.entries.map((entry) => <tr key={entry.id} className="border-b last:border-b-0 hover:bg-slate-50">
            <td className="border-r px-3 py-2">{onFocus ? <button
              type="button"
              className="cursor-pointer font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() => onFocus(entry)}
            >{entry.no}</button> : <Link
              href={`/market-replay/${datasetId}/history/${entry.journalSessionId}?trade=${entry.no}`}
              className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-label={copy.paperTrading.openHistoricalReplay(entry.no)}
            >{entry.no}</Link>}</td>
            <td className="border-r px-3 py-2">{date(entry)}</td>
            <td className="border-r px-3 py-2">{entry.direction === "LONG" ? copy.paperTrading.long : copy.paperTrading.short}</td>
            <td className="w-52 min-w-52 max-w-52 border-r p-1 text-left">
              <div className="min-w-0 max-w-full">
                <Select
                  value={entry.setupOptionId ?? noSetupValue}
                  onValueChange={(value) => void updateSetup(entry, value)}
                  disabled={setupOptionsLoading || savingSetupIds.has(entry.id)}
                >
                  <SelectTrigger
                    className="h-8 min-w-0 max-w-full overflow-hidden border-transparent bg-transparent px-2 text-left shadow-none hover:border-slate-300 hover:bg-white data-[state=open]:border-blue-300 data-[state=open]:bg-white"
                    aria-label={copy.paperTrading.editSetup(entry.no)}
                    aria-busy={savingSetupIds.has(entry.id)}
                    title={entry.setupOption?.name ?? undefined}
                  >
                    <SelectValue className="min-w-0 flex-1 overflow-hidden">
                      <span className="flex min-w-0 max-w-full items-center gap-1.5">
                        {savingSetupIds.has(entry.id) ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
                        <span className="block min-w-0 flex-1 truncate">{entry.setupOption?.name ?? copy.paperTrading.chooseSetup}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="max-w-[min(28rem,calc(100vw-2rem))]"
                  >
                    <SelectItem value={noSetupValue}>{copy.paperTrading.clearSetup}</SelectItem>
                    {setupOptions.map((option) => <SelectItem
                      key={option.id}
                      value={option.id}
                      disabled={!option.active && option.id !== entry.setupOptionId}
                      className="whitespace-normal break-words"
                    >
                      {option.name}
                    </SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </td>
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
