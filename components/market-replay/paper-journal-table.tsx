"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pencil, RotateCcw, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { ExpressionFilterPopover } from "@/components/ui/expression-filter-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { MultiOptionFilterPopover, type FilterOption } from "@/components/ui/multi-option-filter-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { formatInterval } from "@/lib/market-replay/types";
import { utcDateParts } from "@/lib/market-replay/display-timezone";
import {
  compileReplayJournalFilters,
  countActiveReplayJournalFilters,
  createEmptyReplayJournalFilters,
  hasActiveReplayJournalFilters,
  NO_SETUP_FILTER_VALUE,
  replayJournalExpressionFilterKeys,
  type ReplayJournalExpressionFilterKey,
  type ReplayJournalFilters,
  type ReplayJournalOptionFilterKey,
} from "@/lib/paper-trading/journal-filters";
import type { ReplayJournalEntryData, ReplayJournalSummary } from "@/lib/paper-trading/types";

type JournalSessionSummary = {
  id: string;
  name: string;
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
  selectedSessionId?: string | null;
  summary?: ReplayJournalSummary;
  filterOptions?: {
    setups: FilterOption[];
    hasEntriesWithoutSetup: boolean;
  };
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

type TradeOption = {
  id: string;
  type: "INSTRUMENT" | "STRATEGY";
  name: string;
  active: boolean;
};

type TradeTag = {
  id: string;
  name: string;
};

type JournalColumnId =
  | "no" | "date" | "direction" | "setup" | "reason" | "abr" | "initialRisk"
  | "initialRiskAbr" | "actualRisk" | "actualRiskAbr" | "actualInitialRiskRatio"
  | "gainLoss" | "result" | "abrRr" | "initialRiskRr" | "actualRiskRr";

const journalColumns: {
  id: JournalColumnId;
  label: string;
  text: boolean;
  className?: string;
  expressionFilterKey?: ReplayJournalExpressionFilterKey;
  optionFilterKey?: ReplayJournalOptionFilterKey;
}[] = [
  { id: "no", label: "No", text: false },
  { id: "date", label: "Date", text: false },
  { id: "direction", label: "Direction", text: false, optionFilterKey: "directions" },
  { id: "setup", label: copy.paperTrading.setup, text: true, className: "w-52 min-w-52 max-w-52", optionFilterKey: "setupOptionIds" },
  { id: "reason", label: copy.paperTrading.tradeReason, text: true, className: "w-64 min-w-64 max-w-64" },
  { id: "abr", label: "ABR", text: false },
  { id: "initialRisk", label: "iRisk", text: false },
  { id: "initialRiskAbr", label: "iRisk / ABR", text: false, expressionFilterKey: "initialRiskAbr" },
  { id: "actualRisk", label: "aRisk", text: false },
  { id: "actualRiskAbr", label: "aRisk / ABR", text: false, expressionFilterKey: "actualRiskAbr" },
  { id: "actualInitialRiskRatio", label: "aRisk / iRisk", text: false, expressionFilterKey: "actualInitialRiskRatio" },
  { id: "gainLoss", label: "Gain / Loss", text: false },
  { id: "result", label: "Result", text: false, optionFilterKey: "results" },
  { id: "abrRr", label: "ABR RR", text: false, expressionFilterKey: "abrRr" },
  { id: "initialRiskRr", label: "iRisk RR", text: false, expressionFilterKey: "initialRiskRr" },
  { id: "actualRiskRr", label: "aRisk RR", text: false, expressionFilterKey: "actualRiskRr" },
];
const defaultVisibleColumnIds = journalColumns.map((column) => column.id);
const columnPreferenceKey = "replay-journal-visible-columns-v1";

const noSetupValue = "__NO_SETUP__";
const pageSizeOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 10);

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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [setupOptions, setSetupOptions] = useState<TradeOption[]>([]);
  const [setupOptionsLoading, setSetupOptionsLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [savingSetupIds, setSavingSetupIds] = useState<Set<string>>(() => new Set());
  const [reasonTagOptions, setReasonTagOptions] = useState<TradeTag[]>([]);
  const [reasonTagsLoading, setReasonTagsLoading] = useState(true);
  const [reasonTagsError, setReasonTagsError] = useState<string | null>(null);
  const [savingReasonTagIds, setSavingReasonTagIds] = useState<Set<string>>(() => new Set());
  const [visibleColumnsOpen, setVisibleColumnsOpen] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState<JournalColumnId[]>(defaultVisibleColumnIds);
  const [draftVisibleColumnIds, setDraftVisibleColumnIds] = useState<JournalColumnId[]>(defaultVisibleColumnIds);
  const [columnPreferencesLoaded, setColumnPreferencesLoaded] = useState(false);
  const [summary, setSummary] = useState<ReplayJournalSummary | null>(null);
  const [filterDrafts, setFilterDrafts] = useState<ReplayJournalFilters>(createEmptyReplayJournalFilters);
  const [appliedFilters, setAppliedFilters] = useState<ReplayJournalFilters>(createEmptyReplayJournalFilters);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [setupFilterOptions, setSetupFilterOptions] = useState<FilterOption[]>([]);
  const [hasEntriesWithoutSetup, setHasEntriesWithoutSetup] = useState(false);
  const appliedFiltersRef = useRef(appliedFilters);
  const loadRequestIdRef = useRef(0);

  const load = useCallback(async ({
    cursor = 0,
    append = false,
    sessionId,
    requestedPage = 1,
    take = scope === "history" ? 20 : 100,
  }: {
    cursor?: number;
    append?: boolean;
    sessionId?: string;
    requestedPage?: number;
    take?: number;
  } = {}) => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        scope,
        cursor: String(cursor),
        page: String(requestedPage),
        take: String(take),
      });
      if (sessionId) params.set("sessionId", sessionId);
      if (scope === "history") {
        for (const key of replayJournalExpressionFilterKeys) {
          const expression = appliedFiltersRef.current[key].trim();
          if (expression) params.set(key, expression);
        }
        for (const value of appliedFiltersRef.current.directions) params.append("directions", value);
        for (const value of appliedFiltersRef.current.setupOptionIds) params.append("setupOptionIds", value);
        for (const value of appliedFiltersRef.current.results) params.append("results", value);
      }
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal?${params}`);
      const data = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.journalLoadFailed);
      if (requestId !== loadRequestIdRef.current) return;
      setItems((current) => append ? [...current, ...data.items] : data.items);
      setSessions(data.sessions);
      if (scope === "history") {
        setSelectedSessionId(data.selectedSessionId ?? null);
        setPage(data.pagination?.page ?? 1);
        setPageSize(data.pagination?.pageSize ?? take);
        setTotalItems(data.pagination?.totalItems ?? 0);
        setTotalPages(data.pagination?.totalPages ?? 1);
        setSummary(data.summary ?? null);
        setSetupFilterOptions(data.filterOptions?.setups ?? []);
        setHasEntriesWithoutSetup(data.filterOptions?.hasEntriesWithoutSetup ?? false);
      }
      setNextCursor(data.nextCursor);
      setError(null);
    } catch (cause) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : copy.paperTrading.journalLoadFailed);
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [datasetId, scope]);

  useEffect(() => { void load(); }, [load]);

  function changeExpressionFilter(key: ReplayJournalExpressionFilterKey, value: string) {
    const next = { ...filterDrafts, [key]: value };
    setFilterDrafts(next);
    if (compileReplayJournalFilters(next).error) return;

    appliedFiltersRef.current = next;
    setAppliedFilters(next);
    setPage(1);
    void load({ sessionId: selectedSessionId ?? undefined, requestedPage: 1, take: pageSize });
  }

  function changeOptionFilter(key: ReplayJournalOptionFilterKey, values: string[]) {
    const nextDrafts = { ...filterDrafts, [key]: values };
    const nextApplied = { ...appliedFiltersRef.current, [key]: values } as ReplayJournalFilters;
    setFilterDrafts(nextDrafts);
    appliedFiltersRef.current = nextApplied;
    setAppliedFilters(nextApplied);
    setPage(1);
    void load({ sessionId: selectedSessionId ?? undefined, requestedPage: 1, take: pageSize });
  }

  function clearAllExpressionFilters() {
    const next = createEmptyReplayJournalFilters();
    setFilterDrafts(next);
    appliedFiltersRef.current = next;
    setAppliedFilters(next);
    setOpenFilter(null);
    setPage(1);
    void load({ sessionId: selectedSessionId ?? undefined, requestedPage: 1, take: pageSize });
  }

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

  useEffect(() => {
    let cancelled = false;
    async function loadReasonTags() {
      setReasonTagsLoading(true);
      try {
        const response = await fetch("/api/trade-tags");
        const data: unknown = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error(copy.paperTrading.reasonTagsLoadFailed);
        if (!cancelled) {
          setReasonTagOptions((data as TradeTag[]).map((tag) => ({ id: tag.id, name: tag.name })));
          setReasonTagsError(null);
        }
      } catch {
        if (!cancelled) setReasonTagsError(copy.paperTrading.reasonTagsLoadFailed);
      } finally {
        if (!cancelled) setReasonTagsLoading(false);
      }
    }
    void loadReasonTags();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (scope !== "history") return;
    const stored = window.localStorage.getItem(columnPreferenceKey);
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const allowed = new Set<JournalColumnId>(defaultVisibleColumnIds);
          const next = parsed.filter((value): value is JournalColumnId => typeof value === "string" && allowed.has(value as JournalColumnId));
          if (next.length > 0) {
            setVisibleColumnIds(next);
            setDraftVisibleColumnIds(next);
          }
        }
      } catch {
        window.localStorage.removeItem(columnPreferenceKey);
      }
    }
    setColumnPreferencesLoaded(true);
  }, [scope]);

  useEffect(() => {
    if (scope === "history" && columnPreferencesLoaded) {
      window.localStorage.setItem(columnPreferenceKey, JSON.stringify(visibleColumnIds));
    }
  }, [columnPreferencesLoaded, scope, visibleColumnIds]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal/sessions/${deleteTarget}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.journalDeleteFailed);
      setDeleteTarget(null);
      setStatus(null);
      await load({ take: pageSize });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.paperTrading.journalDeleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  function beginRename() {
    if (!selectedSession) return;
    setRenameDraft(selectedSession.name);
    setRenameError(null);
    setRenameOpen(true);
  }

  async function renameSession() {
    if (!selectedSession) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenameError(copy.paperTrading.journalSessionNameRequired);
      return;
    }
    if (name.length > 80) {
      setRenameError(copy.paperTrading.journalSessionNameTooLong);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal/sessions/${selectedSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json() as { id?: string; name?: string; error?: string };
      if (!response.ok || !data.id || !data.name) {
        throw new Error(data.error ?? copy.paperTrading.journalSessionRenameFailed);
      }
      setSessions((current) => current.map((session) => (
        session.id === data.id ? { ...session, name: data.name! } : session
      )));
      setRenameOpen(false);
      setStatus(copy.paperTrading.journalSessionRenamed);
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : copy.paperTrading.journalSessionRenameFailed);
    } finally {
      setRenaming(false);
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
      setItems((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        setupOptionId: data.setupOptionId,
        setupOption: data.setupOption,
      } : item));
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

  async function updateReasonTags(entry: ReplayJournalEntryData, reasonTagIds: string[]) {
    const currentIds = entry.reasonTags.map((tag) => tag.id);
    if (currentIds.length === reasonTagIds.length && currentIds.every((id) => reasonTagIds.includes(id))) return true;
    const previousReasonTags = entry.reasonTags;
    const nextReasonTags = reasonTagIds
      .map((id) => reasonTagOptions.find((tag) => tag.id === id))
      .filter((tag): tag is TradeTag => Boolean(tag));

    setReasonTagsError(null);
    setItems((current) => current.map((item) => item.id === entry.id ? { ...item, reasonTags: nextReasonTags } : item));
    setSavingReasonTagIds((current) => new Set(current).add(entry.id));

    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonTagIds }),
      });
      const data = await response.json() as ReplayJournalEntryData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.reasonTagsUpdateFailed);
      setItems((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        reasonTags: data.reasonTags,
      } : item));
      return true;
    } catch {
      setItems((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        reasonTags: previousReasonTags,
      } : item));
      setReasonTagsError(copy.paperTrading.reasonTagsUpdateFailed);
      return false;
    } finally {
      setSavingReasonTagIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  function openVisibleColumns() {
    setDraftVisibleColumnIds(visibleColumnIds);
    setVisibleColumnsOpen(true);
  }

  function toggleDraftColumn(columnId: JournalColumnId) {
    setDraftVisibleColumnIds((current) => current.includes(columnId)
      ? current.filter((id) => id !== columnId)
      : defaultVisibleColumnIds.filter((id) => id === columnId || current.includes(id)));
  }

  function applyVisibleColumns() {
    if (draftVisibleColumnIds.length === 0) return;
    setVisibleColumnIds(draftVisibleColumnIds);
    setVisibleColumnsOpen(false);
  }

  if (loading && items.length === 0 && sessions.length === 0) return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{copy.paperTrading.journalLoading}</div>;
  if (error && items.length === 0 && sessions.length === 0) return <p className="py-6 text-sm text-red-600" role="alert">{error}</p>;
  if (items.length === 0 && sessions.length === 0) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">{copy.paperTrading.noJournalEntries}</p>;

  const startRow = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, totalItems);
  const visibleColumnSet = new Set(visibleColumnIds);
  const activeFilterCount = countActiveReplayJournalFilters(appliedFilters);
  const hasActiveFilters = hasActiveReplayJournalFilters(appliedFilters);
  const optionFilters: Record<ReplayJournalOptionFilterKey, FilterOption[]> = {
    directions: [
      { value: "LONG", label: copy.paperTrading.long },
      { value: "SHORT", label: copy.paperTrading.short },
    ],
    setupOptionIds: [
      ...(hasEntriesWithoutSetup ? [{ value: NO_SETUP_FILTER_VALUE, label: copy.paperTrading.clearSetup }] : []),
      ...setupFilterOptions,
    ],
    results: [
      { value: "W", label: copy.paperTrading.journalResultWin },
      { value: "L", label: copy.paperTrading.journalResultLoss },
      { value: "BE", label: copy.paperTrading.journalResultBreakEven },
    ],
  };

  return <div className="space-y-4" aria-busy={loading}>
    {scope === "history" && selectedSession ? <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full space-y-2 sm:max-w-xl">
          <Label htmlFor="replay-journal-session">{copy.paperTrading.journalSessionSelect}</Label>
          <Select
            value={selectedSession.id}
            onValueChange={(value) => {
              setStatus(null);
              setSelectedSessionId(value);
              setSummary(null);
              setPage(1);
              void load({ sessionId: value, requestedPage: 1, take: pageSize });
            }}
            disabled={loading || deleting}
          >
            <SelectTrigger id="replay-journal-session" className="w-full bg-white">
              <SelectValue placeholder={copy.paperTrading.journalSessionSelectPlaceholder} />
            </SelectTrigger>
            <SelectContent className="max-w-[min(40rem,calc(100vw-2rem))]">
              {sessions.map((session) => <SelectItem key={session.id} value={session.id}>
                {session.name} · {new Date(session.createdAt).toLocaleString("zh-CN")}
              </SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openVisibleColumns}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            {copy.paperTrading.setVisibleColumns}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={beginRename} disabled={loading || deleting}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {copy.paperTrading.renameJournalSession}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-800">{selectedSession.name}</span>
        <span className="tabular-nums">{new Date(selectedSession.createdAt).toLocaleString("zh-CN")}</span>
        <span>{selectedSession.entryCount} {copy.paperTrading.journalRows}</span>
        <span>{selectedSession.archivedAt ? copy.paperTrading.journalArchived : copy.paperTrading.journalCurrent}</span>
        {selectedSession.archivedAt ? <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-red-600" onClick={() => setDeleteTarget(selectedSession.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{copy.paperTrading.deleteJournalSession}</Button> : null}
      </div>
      {summary ? <Card className="shadow-none">
        <CardHeader className="p-4 pb-3">
          <CardTitle>{copy.paperTrading.journalStatistics}</CardTitle>
          <CardDescription>
            {hasActiveFilters
              ? copy.paperTrading.journalStatisticsFilteredDescription
              : copy.paperTrading.journalStatisticsDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-3">
          <JournalStat
            label={copy.paperTrading.journalWinRate}
            value={formatPercent(summary.winRate)}
          />
          <div className="rounded-md border bg-slate-50 p-3">
            <div className="grid grid-cols-2 gap-4">
              <JournalStatValue
                label={copy.paperTrading.totalProfitPoints}
                value={formatNumber(summary.totalProfitPoints)}
                valueClassName="text-emerald-700"
              />
              <JournalStatValue
                label={copy.paperTrading.totalLossPoints}
                value={formatNumber(summary.totalLossPoints)}
                valueClassName="text-red-700"
              />
            </div>
          </div>
          <JournalStat
            label={copy.paperTrading.actualProfitLossRatio}
            value={summary.actualProfitLossRatio === null ? copy.common.dash : formatNumber(summary.actualProfitLossRatio)}
            description={copy.paperTrading.actualProfitLossRatioDescription}
          />
        </CardContent>
      </Card> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 text-sm text-slate-600">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {copy.paperTrading.journalPaginationRange
              .replace("{start}", startRow.toLocaleString("zh-CN"))
              .replace("{end}", endRow.toLocaleString("zh-CN"))
              .replace("{total}", totalItems.toLocaleString("zh-CN"))}
          </p>
          {hasActiveFilters ? <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={clearAllExpressionFilters}
            disabled={loading}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {copy.paperTrading.journalFiltersActive(activeFilterCount)} · {copy.paperTrading.clearJournalFilters}
          </Button> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">{copy.tradeJournals.pagination.rowsPerPage}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              const nextPageSize = Number(value);
              setPageSize(nextPageSize);
              setPage(1);
              void load({ sessionId: selectedSession.id, requestedPage: 1, take: nextPageSize });
            }}
            disabled={loading}
          >
            <SelectTrigger className="w-24" aria-label={copy.tradeJournals.pagination.rowsPerPage}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </> : null}
    {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
    {status ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status" aria-live="polite">{status}</p> : null}
    {setupError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{setupError}</p> : null}
    {reasonTagsError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{reasonTagsError}</p> : null}
    <section className="space-y-2">
      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full min-w-max border-collapse text-right text-sm tabular-nums">
          <thead className="bg-blue-50 text-xs text-slate-700"><tr>
            {journalColumns.filter((column) => visibleColumnSet.has(column.id)).map((column) => (
              <th
                key={column.id}
                className={`min-w-24 whitespace-nowrap border-b border-r px-3 py-2 font-semibold last:border-r-0 ${column.text ? "text-left" : ""} ${column.className ?? ""}`}
              >
                <div className={`flex items-center gap-1 ${column.text ? "justify-start" : "justify-end"}`}>
                  <span>{column.label}</span>
                  {scope === "history" && column.expressionFilterKey ? <ExpressionFilterPopover
                    id={`replay-${column.expressionFilterKey}`}
                    label={column.label}
                    conditionLabel={copy.paperTrading.journalFilterCondition(column.label)}
                    expression={filterDrafts[column.expressionFilterKey]}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                    onExpressionChange={(value) => changeExpressionFilter(column.expressionFilterKey!, value)}
                    onClear={() => changeExpressionFilter(column.expressionFilterKey!, "")}
                    disabled={loading}
                  /> : null}
                  {scope === "history" && column.optionFilterKey ? <MultiOptionFilterPopover
                    id={`replay-${column.optionFilterKey}`}
                    label={column.label}
                    conditionLabel={copy.paperTrading.journalFilterCondition(column.label)}
                    values={filterDrafts[column.optionFilterKey]}
                    options={optionFilters[column.optionFilterKey]}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                    onChange={(values) => changeOptionFilter(column.optionFilterKey!, values)}
                    onClear={() => changeOptionFilter(column.optionFilterKey!, [])}
                    disabled={loading}
                  /> : null}
                </div>
              </th>
            ))}
          </tr></thead>
          <tbody>{items.length === 0 && scope === "history" ? <tr>
            <td colSpan={visibleColumnIds.length} className="px-4 py-8 text-center text-sm text-slate-500">
              {hasActiveFilters ? copy.paperTrading.noFilteredJournalEntries : copy.paperTrading.noJournalEntries}
            </td>
          </tr> : items.map((entry) => <tr key={entry.id} className="border-b last:border-b-0 hover:bg-slate-50">
            {visibleColumnSet.has("no") ? <td className="border-r px-3 py-2 last:border-r-0">{onFocus ? <button
              type="button"
              className="cursor-pointer font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() => onFocus(entry)}
            >{entry.no}</button> : <Link
              href={`/market-replay/${datasetId}/history/${entry.journalSessionId}?trade=${entry.no}`}
              className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-label={copy.paperTrading.openHistoricalReplay(entry.no)}
            >{entry.no}</Link>}</td> : null}
            {visibleColumnSet.has("date") ? <td className="border-r px-3 py-2 last:border-r-0">{date(entry)}</td> : null}
            {visibleColumnSet.has("direction") ? <td className="border-r px-3 py-2 last:border-r-0">{entry.direction === "LONG" ? copy.paperTrading.long : copy.paperTrading.short}</td> : null}
            {visibleColumnSet.has("setup") ? <td className="w-52 min-w-52 max-w-52 border-r p-1 text-left last:border-r-0">
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
            </td> : null}
            {visibleColumnSet.has("reason") ? <td className="w-64 min-w-64 max-w-64 border-r p-1 text-left last:border-r-0">
              <MultiSelect
                value={entry.reasonTags.map((tag) => tag.id)}
                options={reasonTagOptions.map((tag) => ({ value: tag.id, label: tag.name }))}
                onCommit={(values) => updateReasonTags(entry, values)}
                placeholder={copy.paperTrading.chooseTradeReason}
                emptyMessage={copy.paperTrading.noTradeReasonOptions}
                ariaLabel={copy.paperTrading.editTradeReason(entry.no)}
                saveLabel={copy.paperTrading.saveTradeReason}
                cancelLabel={copy.common.cancel}
                disabled={reasonTagsLoading || savingReasonTagIds.has(entry.id)}
              />
            </td> : null}
            {visibleColumnSet.has("abr") ? <td className="border-r px-3 py-2 last:border-r-0" title={`${formatInterval(entry.displayIntervalSeconds)} · ABR(${entry.abrLength})`}>{number(entry.abrValue)}</td> : null}
            {visibleColumnSet.has("initialRisk") ? <td className="border-r px-3 py-2 last:border-r-0">{number(entry.initialRisk)}</td> : null}
            {visibleColumnSet.has("initialRiskAbr") ? <td className="border-r px-3 py-2 last:border-r-0">{ratio(entry.initialRiskAbr)}</td> : null}
            {visibleColumnSet.has("actualRisk") ? <td className="border-r px-3 py-2 last:border-r-0">{number(entry.actualRisk)}</td> : null}
            {visibleColumnSet.has("actualRiskAbr") ? <td className="border-r px-3 py-2 last:border-r-0">{ratio(entry.actualRiskAbr)}</td> : null}
            {visibleColumnSet.has("actualInitialRiskRatio") ? <td className="border-r px-3 py-2 last:border-r-0">{ratio(entry.actualInitialRiskRatio)}</td> : null}
            {visibleColumnSet.has("gainLoss") ? <td className={`border-r px-3 py-2 font-medium last:border-r-0 ${entry.gainLoss > 0 ? "text-emerald-700" : entry.gainLoss < 0 ? "text-red-700" : ""}`}>{number(entry.gainLoss)}</td> : null}
            {visibleColumnSet.has("result") ? <td className="border-r px-3 py-2 last:border-r-0">{entry.result}</td> : null}
            {visibleColumnSet.has("abrRr") ? <td className="border-r px-3 py-2 last:border-r-0">{ratio(entry.abrRr)}</td> : null}
            {visibleColumnSet.has("initialRiskRr") ? <td className="border-r px-3 py-2 last:border-r-0">{ratio(entry.initialRiskRr)}</td> : null}
            {visibleColumnSet.has("actualRiskRr") ? <td className="border-r px-3 py-2 last:border-r-0">{ratio(entry.actualRiskRr)}</td> : null}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    {scope === "history" && selectedSession ? <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600">
        {copy.tradeJournals.pagination.page
          .replace("{page}", page.toLocaleString("zh-CN"))
          .replace("{totalPages}", totalPages.toLocaleString("zh-CN"))}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => void load({ sessionId: selectedSession.id, requestedPage: page - 1, take: pageSize })}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />{copy.tradeJournals.pagination.previous}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={loading || page >= totalPages} onClick={() => void load({ sessionId: selectedSession.id, requestedPage: page + 1, take: pageSize })}>
          {copy.tradeJournals.pagination.next}<ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div> : null}
    {scope === "current" && nextCursor !== null ? <div className="text-center"><Button type="button" variant="outline" disabled={loading} onClick={() => void load({ cursor: nextCursor, append: true, take: 100 })}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.paperTrading.loadMoreJournal}</Button></div> : null}
    <Dialog
      open={visibleColumnsOpen}
      title={copy.paperTrading.visibleColumnsTitle}
      description={copy.paperTrading.visibleColumnsDescription}
      onClose={() => setVisibleColumnsOpen(false)}
      className="max-w-lg"
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {journalColumns.map((column) => (
            <label key={column.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm text-slate-800 hover:bg-slate-50">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-blue-600 focus-visible:ring-2 focus-visible:ring-ring"
                checked={draftVisibleColumnIds.includes(column.id)}
                onChange={() => toggleDraftColumn(column.id)}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
        {draftVisibleColumnIds.length === 0 ? <p className="text-xs text-red-600" role="alert">{copy.paperTrading.visibleColumnsRequired}</p> : null}
        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => setDraftVisibleColumnIds(defaultVisibleColumnIds)}>
            {copy.paperTrading.visibleColumnsReset}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setVisibleColumnsOpen(false)}>{copy.common.cancel}</Button>
            <Button type="button" onClick={applyVisibleColumns} disabled={draftVisibleColumnIds.length === 0}>
              {copy.paperTrading.visibleColumnsSave}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
    <Dialog
      open={renameOpen}
      title={copy.paperTrading.renameJournalSessionTitle}
      description={copy.paperTrading.renameJournalSessionDescription}
      onClose={() => { if (!renaming) setRenameOpen(false); }}
      className="max-w-md"
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void renameSession(); }}>
        <div className="space-y-2">
          <Label htmlFor="replay-journal-session-name">{copy.paperTrading.journalSessionName}</Label>
          <Input
            id="replay-journal-session-name"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            placeholder={copy.paperTrading.journalSessionNamePlaceholder}
            maxLength={80}
            disabled={renaming}
            aria-describedby={renameError ? "replay-journal-session-name-error" : undefined}
            autoFocus
          />
          {renameError ? <p id="replay-journal-session-name-error" className="text-xs text-red-600" role="alert">{renameError}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => setRenameOpen(false)} disabled={renaming}>{copy.common.cancel}</Button>
          <Button type="submit" disabled={renaming || !renameDraft.trim()}>
            {renaming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {copy.paperTrading.saveJournalSessionName}
          </Button>
        </div>
      </form>
    </Dialog>
    <ConfirmDialog open={deleteTarget !== null} title={copy.paperTrading.deleteJournalSessionTitle} description={copy.paperTrading.deleteJournalSessionConfirm} isLoading={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
  </div>;
}

function JournalStat({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <JournalStatValue label={label} value={value} />
      {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
    </div>
  );
}

function JournalStatValue({
  label,
  value,
  valueClassName = "text-slate-950",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName}`}>{value}</p>
    </div>
  );
}
