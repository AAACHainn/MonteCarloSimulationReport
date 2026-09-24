"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Pencil, RotateCcw, Settings2, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { formatInterval } from "@/lib/market-replay/types";
import { utcDateParts } from "@/lib/market-replay/display-timezone";
import {
  MAX_JOURNAL_COLUMN_WIDTH,
  MIN_JOURNAL_COLUMN_WIDTH,
  clampJournalColumnWidth,
  normalizeJournalTableWidth,
  parseStoredJournalColumnWidths,
  parseStoredJournalTableOffset,
  parseStoredJournalTableWidth,
  resizeJournalTableFromStartEdge,
} from "@/lib/market-replay/journal-column-widths";
import {
  compileReplayJournalFilters,
  countActiveReplayJournalFilters,
  createEmptyReplayJournalFilters,
  hasActiveReplayJournalFilters,
  NO_SETUP_FILTER_VALUE,
  NO_TRADE_REASON_FILTER_VALUE,
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
  selectedSessionId?: string | null;
  summary?: ReplayJournalSummary;
  filterOptions?: {
    setups: FilterOption[];
    hasEntriesWithoutSetup: boolean;
    tradeReasons: FilterOption[];
    hasEntriesWithoutTradeReason: boolean;
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

type TradeReason = {
  id: string;
  name: string;
};

type JournalColumnId =
  | "no" | "date" | "direction" | "setup" | "reason" | "abr" | "initialRisk"
  | "initialRiskAbr" | "actualRisk" | "actualRiskAbr" | "actualInitialRiskRatio"
  | "gainLoss" | "result" | "abrRr" | "initialRiskRr" | "actualRiskRr" | "review";

const journalColumns: {
  id: JournalColumnId;
  label: string;
  text: boolean;
  defaultWidth: number;
  expressionFilterKey?: ReplayJournalExpressionFilterKey;
  optionFilterKey?: ReplayJournalOptionFilterKey;
}[] = [
  { id: "no", label: "No", text: false, defaultWidth: 72 },
  { id: "date", label: "Date", text: false, defaultWidth: 120 },
  { id: "direction", label: "Direction", text: false, defaultWidth: 112, optionFilterKey: "directions" },
  { id: "setup", label: copy.paperTrading.setup, text: true, defaultWidth: 208, optionFilterKey: "setupOptionIds" },
  { id: "reason", label: copy.paperTrading.tradeReason, text: true, defaultWidth: 256, optionFilterKey: "tradeReasonIds" },
  { id: "abr", label: "ABR", text: false, defaultWidth: 104 },
  { id: "initialRisk", label: "iRisk", text: false, defaultWidth: 104 },
  { id: "initialRiskAbr", label: "iRisk / ABR", text: false, defaultWidth: 128, expressionFilterKey: "initialRiskAbr" },
  { id: "actualRisk", label: "aRisk", text: false, defaultWidth: 104 },
  { id: "actualRiskAbr", label: "aRisk / ABR", text: false, defaultWidth: 128, expressionFilterKey: "actualRiskAbr" },
  { id: "actualInitialRiskRatio", label: "aRisk / iRisk", text: false, defaultWidth: 128, expressionFilterKey: "actualInitialRiskRatio" },
  { id: "gainLoss", label: "Gain / Loss", text: false, defaultWidth: 128 },
  { id: "result", label: "Result", text: false, defaultWidth: 104, optionFilterKey: "results" },
  { id: "abrRr", label: "ABR RR", text: false, defaultWidth: 112, expressionFilterKey: "abrRr" },
  { id: "initialRiskRr", label: "iRisk RR", text: false, defaultWidth: 112, expressionFilterKey: "initialRiskRr" },
  { id: "actualRiskRr", label: "aRisk RR", text: false, defaultWidth: 112, expressionFilterKey: "actualRiskRr" },
  { id: "review", label: copy.paperTrading.review, text: true, defaultWidth: 288 },
];
const defaultVisibleColumnIds = journalColumns.map((column) => column.id);
const defaultColumnWidths = Object.fromEntries(
  journalColumns.map((column) => [column.id, column.defaultWidth]),
) as Record<JournalColumnId, number>;
const columnPreferenceKey = "replay-journal-visible-columns-v1";
const columnWidthPreferenceKey = "replay-journal-column-widths-v1";
const tableWidthPreferenceKey = "replay-journal-table-width-v1";
const tableOffsetPreferenceKey = "replay-journal-table-offset-v1";

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

function reviewLength(value: string) {
  return Array.from(value).length;
}

function limitReview(value: string) {
  return Array.from(value).slice(0, 300).join("");
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
  const [tradeReasonOptions, setTradeReasonOptions] = useState<TradeReason[]>([]);
  const [tradeReasonsLoading, setTradeReasonsLoading] = useState(true);
  const [tradeReasonsError, setTradeReasonsError] = useState<string | null>(null);
  const [savingTradeReasonIds, setSavingTradeReasonIds] = useState<Set<string>>(() => new Set());
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [savingReviewIds, setSavingReviewIds] = useState<Set<string>>(() => new Set());
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewDialogEntryId, setReviewDialogEntryId] = useState<string | null>(null);
  const [reviewDialogDraft, setReviewDialogDraft] = useState("");
  const [visibleColumnsOpen, setVisibleColumnsOpen] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState<JournalColumnId[]>(defaultVisibleColumnIds);
  const [draftVisibleColumnIds, setDraftVisibleColumnIds] = useState<JournalColumnId[]>(defaultVisibleColumnIds);
  const [columnPreferencesLoaded, setColumnPreferencesLoaded] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<JournalColumnId, number>>(defaultColumnWidths);
  const [columnWidthsLoaded, setColumnWidthsLoaded] = useState(false);
  const [tableWidthPreference, setTableWidthPreference] = useState<number | null>(null);
  const [tableLeftOffset, setTableLeftOffset] = useState(0);
  const [tableViewportElement, setTableViewportElement] = useState<HTMLElement | null>(null);
  const [tableViewportWidth, setTableViewportWidth] = useState(0);
  const [resizingTarget, setResizingTarget] = useState<JournalColumnId | "table-start" | "table-end" | null>(null);
  const [summary, setSummary] = useState<ReplayJournalSummary | null>(null);
  const [filterDrafts, setFilterDrafts] = useState<ReplayJournalFilters>(createEmptyReplayJournalFilters);
  const [appliedFilters, setAppliedFilters] = useState<ReplayJournalFilters>(createEmptyReplayJournalFilters);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [setupFilterOptions, setSetupFilterOptions] = useState<FilterOption[]>([]);
  const [hasEntriesWithoutSetup, setHasEntriesWithoutSetup] = useState(false);
  const [tradeReasonFilterOptions, setTradeReasonFilterOptions] = useState<FilterOption[]>([]);
  const [hasEntriesWithoutTradeReason, setHasEntriesWithoutTradeReason] = useState(false);
  const appliedFiltersRef = useRef(appliedFilters);
  const loadRequestIdRef = useRef(0);
  const cancelledInlineReviewIdsRef = useRef(new Set<string>());
  const resizeRef = useRef<
    | {
      kind: "column";
      columnId: JournalColumnId;
      pointerId: number;
      startX: number;
      startColumnWidth: number;
      startTableWidth: number;
    }
    | {
      kind: "table";
      edge: "start" | "end";
      pointerId: number;
      startX: number;
      startTableWidth: number;
      startTableOffset: number;
      minimumWidth: number;
    }
    | null
  >(null);

  const load = useCallback(async ({
    sessionId,
    requestedPage = 1,
    take = 20,
  }: {
    sessionId?: string;
    requestedPage?: number;
    take?: number;
  } = {}) => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        scope,
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
        for (const value of appliedFiltersRef.current.tradeReasonIds) params.append("tradeReasonIds", value);
        for (const value of appliedFiltersRef.current.results) params.append("results", value);
      }
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal?${params}`);
      const data = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.journalLoadFailed);
      if (requestId !== loadRequestIdRef.current) return;
      setItems(data.items);
      setSessions(data.sessions);
      setPage(data.pagination?.page ?? 1);
      setPageSize(data.pagination?.pageSize ?? take);
      setTotalItems(data.pagination?.totalItems ?? data.items.length);
      setTotalPages(data.pagination?.totalPages ?? 1);
      if (scope === "history") {
        setSelectedSessionId(data.selectedSessionId ?? null);
        setSummary(data.summary ?? null);
        setSetupFilterOptions(data.filterOptions?.setups ?? []);
        setHasEntriesWithoutSetup(data.filterOptions?.hasEntriesWithoutSetup ?? false);
        setTradeReasonFilterOptions(data.filterOptions?.tradeReasons ?? []);
        setHasEntriesWithoutTradeReason(data.filterOptions?.hasEntriesWithoutTradeReason ?? false);
      }
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
    async function loadTradeReasons() {
      setTradeReasonsLoading(true);
      try {
        const response = await fetch("/api/trade-reasons");
        const data: unknown = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error(copy.paperTrading.tradeReasonsLoadFailed);
        if (!cancelled) {
          setTradeReasonOptions((data as TradeReason[]).map((reason) => ({ id: reason.id, name: reason.name })));
          setTradeReasonsError(null);
        }
      } catch {
        if (!cancelled) setTradeReasonsError(copy.paperTrading.tradeReasonsLoadFailed);
      } finally {
        if (!cancelled) setTradeReasonsLoading(false);
      }
    }
    void loadTradeReasons();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(columnPreferenceKey);
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const allowed = new Set<JournalColumnId>(defaultVisibleColumnIds);
          const next = parsed.filter((value): value is JournalColumnId => typeof value === "string" && allowed.has(value as JournalColumnId));
          if (next.length > 0) {
            const migrated: JournalColumnId[] = next.includes("review")
              ? next
              : [...next, "review" as JournalColumnId];
            setVisibleColumnIds(migrated);
            setDraftVisibleColumnIds(migrated);
          }
        }
      } catch {
        window.localStorage.removeItem(columnPreferenceKey);
      }
    }
    setColumnPreferencesLoaded(true);

    setColumnWidths(parseStoredJournalColumnWidths(
      window.localStorage.getItem(columnWidthPreferenceKey),
      defaultColumnWidths,
    ));
    setTableWidthPreference(parseStoredJournalTableWidth(
      window.localStorage.getItem(tableWidthPreferenceKey),
    ));
    setTableLeftOffset(parseStoredJournalTableOffset(
      window.localStorage.getItem(tableOffsetPreferenceKey),
    ));
    setColumnWidthsLoaded(true);
  }, []);

  useEffect(() => {
    if (columnPreferencesLoaded) {
      window.localStorage.setItem(columnPreferenceKey, JSON.stringify(visibleColumnIds));
    }
  }, [columnPreferencesLoaded, visibleColumnIds]);

  useEffect(() => {
    if (columnWidthsLoaded) {
      window.localStorage.setItem(columnWidthPreferenceKey, JSON.stringify(columnWidths));
      if (tableWidthPreference === null) {
        window.localStorage.removeItem(tableWidthPreferenceKey);
      } else {
        window.localStorage.setItem(tableWidthPreferenceKey, String(tableWidthPreference));
      }
      window.localStorage.setItem(tableOffsetPreferenceKey, String(tableLeftOffset));
    }
  }, [columnWidths, columnWidthsLoaded, tableLeftOffset, tableWidthPreference]);

  useEffect(() => {
    if (!tableViewportElement) return;
    const updateWidth = () => setTableViewportWidth(tableViewportElement.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(tableViewportElement);
    return () => observer.disconnect();
  }, [tableViewportElement]);

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

  async function updateTradeReasons(entry: ReplayJournalEntryData, tradeReasonIds: string[]) {
    const currentIds = entry.tradeReasons.map((reason) => reason.id);
    if (currentIds.length === tradeReasonIds.length && currentIds.every((id) => tradeReasonIds.includes(id))) return true;
    const previousTradeReasons = entry.tradeReasons;
    const nextTradeReasons = tradeReasonIds
      .map((id) => tradeReasonOptions.find((reason) => reason.id === id))
      .filter((reason): reason is TradeReason => Boolean(reason));

    setTradeReasonsError(null);
    setItems((current) => current.map((item) => item.id === entry.id ? { ...item, tradeReasons: nextTradeReasons } : item));
    setSavingTradeReasonIds((current) => new Set(current).add(entry.id));

    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeReasonIds }),
      });
      const data = await response.json() as ReplayJournalEntryData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.tradeReasonsUpdateFailed);
      setItems((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        tradeReasons: data.tradeReasons,
      } : item));
      return true;
    } catch {
      setItems((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        tradeReasons: previousTradeReasons,
      } : item));
      setTradeReasonsError(copy.paperTrading.tradeReasonsUpdateFailed);
      return false;
    } finally {
      setSavingTradeReasonIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  async function updateReview(entry: ReplayJournalEntryData, value: string, announce = false) {
    const review = limitReview(value);
    if (reviewLength(value) > 300) {
      setReviewError(copy.paperTrading.reviewTooLong);
      return false;
    }
    if (review === entry.review) return true;
    const previousReview = entry.review;

    setReviewError(null);
    setItems((current) => current.map((item) => item.id === entry.id ? { ...item, review } : item));
    setSavingReviewIds((current) => new Set(current).add(entry.id));
    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/paper-journal/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review }),
      });
      const data = await response.json() as ReplayJournalEntryData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.reviewUpdateFailed);
      setItems((current) => current.map((item) => item.id === entry.id ? { ...item, review: data.review } : item));
      if (announce) setStatus(copy.paperTrading.reviewSaved);
      return true;
    } catch {
      setItems((current) => current.map((item) => item.id === entry.id ? { ...item, review: previousReview } : item));
      setReviewError(copy.paperTrading.reviewUpdateFailed);
      return false;
    } finally {
      setSavingReviewIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  function openReviewDialog(entry: ReplayJournalEntryData) {
    setReviewDialogEntryId(entry.id);
    setReviewDialogDraft(reviewDrafts[entry.id] ?? entry.review);
    setReviewError(null);
  }

  async function saveReviewDialog() {
    const entry = items.find((item) => item.id === reviewDialogEntryId);
    if (!entry) return;
    const saved = await updateReview(entry, reviewDialogDraft, true);
    if (!saved) return;
    setReviewDrafts((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setReviewDialogEntryId(null);
  }

  function finishInlineReview(entry: ReplayJournalEntryData) {
    if (cancelledInlineReviewIdsRef.current.delete(entry.id)) return;
    const value = reviewDrafts[entry.id];
    if (value === undefined) return;
    void updateReview(entry, value).finally(() => {
      setReviewDrafts((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
    });
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
    if (!scopedJournalColumns.some((column) => draftVisibleColumnIds.includes(column.id))) return;
    setVisibleColumnIds(draftVisibleColumnIds);
    setVisibleColumnsOpen(false);
  }

  function startResize(
    columnId: JournalColumnId,
    isTableEdge: boolean,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (isTableEdge) {
      startTableResize("end", event);
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      kind: "column",
      columnId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startColumnWidth: columnWidths[columnId],
      startTableWidth: visibleTableWidth,
    };
    setResizingTarget(columnId);
  }

  function startTableResize(
    edge: "start" | "end",
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      kind: "table",
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startTableWidth: visibleTableWidth,
      startTableOffset: tableLeftOffset,
      minimumWidth: Math.max(baseTableWidth, tableViewportWidth),
    };
    setResizingTarget(edge === "start" ? "table-start" : "table-end");
  }

  function continueResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const pointerDelta = event.clientX - resize.startX;
    if (resize.kind === "table") {
      if (resize.edge === "start") {
        const next = resizeJournalTableFromStartEdge({
          startWidth: resize.startTableWidth,
          startOffset: resize.startTableOffset,
          pointerDelta,
          minimumWidth: resize.minimumWidth,
        });
        setTableWidthPreference(next.width);
        setTableLeftOffset(next.offset);
      } else {
        setTableWidthPreference(Math.max(
          resize.minimumWidth,
          normalizeJournalTableWidth(resize.startTableWidth + pointerDelta),
        ));
      }
      return;
    }

    const nextColumnWidth = clampJournalColumnWidth(resize.startColumnWidth + pointerDelta);
    const appliedDelta = nextColumnWidth - resize.startColumnWidth;
    setColumnWidths((current) => ({ ...current, [resize.columnId]: nextColumnWidth }));
    setTableWidthPreference(normalizeJournalTableWidth(resize.startTableWidth + appliedDelta));
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = null;
    setResizingTarget(null);
  }

  function resizeWithKeyboard(
    columnId: JournalColumnId,
    isTableEdge: boolean,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (isTableEdge) {
      resizeTableEdgeWithKeyboard("end", event);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const direction = event.key === "ArrowRight" ? 1 : -1;

    const nextColumnWidth = clampJournalColumnWidth(columnWidths[columnId] + direction * step);
    const appliedDelta = nextColumnWidth - columnWidths[columnId];
    setColumnWidths((current) => ({ ...current, [columnId]: nextColumnWidth }));
    setTableWidthPreference(normalizeJournalTableWidth(visibleTableWidth + appliedDelta));
  }

  function resizeTableEdgeWithKeyboard(
    edge: "start" | "end",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    resizeTableWithKeyboard(edge, event.key === "ArrowRight" ? step : -step);
  }

  function resizeTableWithKeyboard(edge: "start" | "end", pointerDelta: number) {
    const minimumWidth = Math.max(baseTableWidth, tableViewportWidth);
    if (edge === "start") {
      const next = resizeJournalTableFromStartEdge({
        startWidth: visibleTableWidth,
        startOffset: tableLeftOffset,
        pointerDelta,
        minimumWidth,
      });
      setTableWidthPreference(next.width);
      setTableLeftOffset(next.offset);
      return;
    }

    setTableWidthPreference(Math.max(
      minimumWidth,
      normalizeJournalTableWidth(visibleTableWidth + pointerDelta),
    ));
  }

  if (loading && items.length === 0 && sessions.length === 0) return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{copy.paperTrading.journalLoading}</div>;
  if (error && items.length === 0 && sessions.length === 0) return <p className="py-6 text-sm text-red-600" role="alert">{error}</p>;
  if (items.length === 0 && sessions.length === 0) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">{copy.paperTrading.noJournalEntries}</p>;

  const startRow = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, totalItems);
  const scopedJournalColumns = scope === "history"
    ? journalColumns
    : journalColumns.filter((column) => column.id !== "review");
  const visibleColumnSet = new Set(visibleColumnIds);
  const visibleColumns = scopedJournalColumns.filter((column) => visibleColumnSet.has(column.id));
  const baseTableWidth = visibleColumns.reduce((total, column) => total + columnWidths[column.id], 0);
  const visibleTableWidth = Math.max(baseTableWidth, tableViewportWidth, tableWidthPreference ?? 0);
  const distributedTableExtraWidth = visibleColumns.length === 0
    ? 0
    : (visibleTableWidth - baseTableWidth) / visibleColumns.length;
  let accumulatedTableWidth = 0;
  const visibleColumnEdges = visibleColumns.map((column, index) => {
    accumulatedTableWidth += columnWidths[column.id] + distributedTableExtraWidth;
    return {
      column,
      position: accumulatedTableWidth,
      isTableEdge: index === visibleColumns.length - 1,
    };
  });
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
    tradeReasonIds: [
      ...(hasEntriesWithoutTradeReason ? [{ value: NO_TRADE_REASON_FILTER_VALUE, label: copy.paperTrading.noTradeReason }] : []),
      ...tradeReasonFilterOptions,
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
          <Button asChild variant="outline" size="sm">
            <a href={`/api/market-datasets/${datasetId}/paper-journal/sessions/${selectedSession.id}/export`} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              {copy.paperTrading.exportJournalExcel}
            </a>
          </Button>
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
          <JournalWinRateStat
            winRate={formatPercent(summary.winRate)}
            winningTradeCount={summary.winningTradeCount}
            losingTradeCount={summary.losingTradeCount}
            breakEvenTradeCount={summary.breakEvenTradeCount}
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
    {scope === "current" ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-center gap-2 text-sm text-slate-600">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {copy.paperTrading.journalPaginationRange
          .replace("{start}", startRow.toLocaleString("zh-CN"))
          .replace("{end}", endRow.toLocaleString("zh-CN"))
          .replace("{total}", totalItems.toLocaleString("zh-CN"))}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={openVisibleColumns}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          {copy.paperTrading.setVisibleColumns}
        </Button>
        <span className="text-sm text-slate-600">{copy.tradeJournals.pagination.rowsPerPage}</span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            const nextPageSize = Number(value);
            setPageSize(nextPageSize);
            setPage(1);
            void load({ requestedPage: 1, take: nextPageSize });
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
    </div> : null}
    {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
    {status ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status" aria-live="polite">{status}</p> : null}
    {setupError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{setupError}</p> : null}
    {tradeReasonsError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{tradeReasonsError}</p> : null}
    {reviewError && reviewDialogEntryId === null ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{reviewError}</p> : null}
    <section ref={setTableViewportElement} className="space-y-2">
      <div
        className={`relative rounded-md border bg-white ${resizingTarget ? "select-none" : ""}`}
        style={{ width: visibleTableWidth, minWidth: visibleTableWidth, marginLeft: tableLeftOffset }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={copy.paperTrading.resizeJournalTableStart}
          aria-valuemin={Math.max(baseTableWidth, tableViewportWidth)}
          aria-valuemax={Number.MAX_SAFE_INTEGER}
          aria-valuenow={Math.round(visibleTableWidth)}
          tabIndex={0}
          title={copy.paperTrading.resizeJournalTableStartHint}
          className={`group absolute -left-1.5 top-0 z-20 h-full w-3 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:content-[''] hover:after:w-0.5 hover:after:bg-blue-600 focus-visible:after:w-0.5 focus-visible:after:bg-blue-600 ${resizingTarget === "table-start" ? "after:w-0.5 after:bg-blue-600" : "after:bg-transparent"}`}
          onPointerDown={(event) => startTableResize("start", event)}
          onPointerMove={continueResize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={(event) => resizeTableEdgeWithKeyboard("start", event)}
        />
        {visibleColumnEdges.map(({ column, position, isTableEdge }) => (
          <div
            key={`resize-${column.id}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={isTableEdge
              ? copy.paperTrading.resizeJournalTableEnd
              : copy.paperTrading.resizeJournalColumn(column.label)}
            aria-valuemin={isTableEdge
              ? Math.max(baseTableWidth, tableViewportWidth)
              : MIN_JOURNAL_COLUMN_WIDTH}
            aria-valuemax={isTableEdge ? Number.MAX_SAFE_INTEGER : MAX_JOURNAL_COLUMN_WIDTH}
            aria-valuenow={isTableEdge ? Math.round(visibleTableWidth) : columnWidths[column.id]}
            tabIndex={0}
            title={isTableEdge
              ? copy.paperTrading.resizeJournalTableEndHint
              : copy.paperTrading.resizeJournalColumnHint}
            className={`group absolute top-0 z-20 h-full -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:content-[''] hover:after:w-0.5 hover:after:bg-blue-600 focus-visible:after:w-0.5 focus-visible:after:bg-blue-600 ${isTableEdge ? "w-3" : "w-2"} ${resizingTarget === (isTableEdge ? "table-end" : column.id) ? "after:w-0.5 after:bg-blue-600" : "after:bg-transparent"}`}
            style={{ left: position }}
            onPointerDown={(event) => startResize(column.id, isTableEdge, event)}
            onPointerMove={continueResize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onKeyDown={(event) => resizeWithKeyboard(column.id, isTableEdge, event)}
          />
        ))}
        <table
          className="table-fixed border-collapse border-r border-slate-200 text-right text-sm tabular-nums [&_td]:overflow-hidden [&_td]:whitespace-nowrap"
          style={{ width: visibleTableWidth, minWidth: visibleTableWidth }}
        >
          <colgroup>
            {visibleColumns.map((column) => (
              <col
                key={column.id}
                style={{ width: columnWidths[column.id] + distributedTableExtraWidth }}
              />
            ))}
          </colgroup>
          <thead className="bg-blue-50 text-xs text-slate-700"><tr>
            {visibleColumns.map((column) => (
                <th
                  key={column.id}
                  className={`relative whitespace-nowrap border-b border-r px-3 py-2 font-semibold last:border-r-0 ${column.text ? "text-left" : ""}`}
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
            {visibleColumnSet.has("setup") ? <td className="border-r p-1 text-left last:border-r-0">
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
            {visibleColumnSet.has("reason") ? <td className="border-r p-1 text-left last:border-r-0">
              <MultiSelect
                value={entry.tradeReasons.map((reason) => reason.id)}
                options={tradeReasonOptions.map((reason) => ({ value: reason.id, label: reason.name }))}
                onCommit={(values) => updateTradeReasons(entry, values)}
                placeholder={copy.paperTrading.chooseTradeReason}
                emptyMessage={copy.paperTrading.noTradeReasonOptions}
                ariaLabel={copy.paperTrading.editTradeReason(entry.no)}
                saveLabel={copy.paperTrading.saveTradeReason}
                cancelLabel={copy.common.cancel}
                disabled={tradeReasonsLoading || savingTradeReasonIds.has(entry.id)}
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
            {scope === "history" && visibleColumnSet.has("review") ? <td className="border-r p-1 text-left last:border-r-0">
              <div className="relative min-w-0">
                <Input
                  value={reviewDrafts[entry.id] ?? entry.review}
                  onFocus={() => setReviewDrafts((current) => current[entry.id] === undefined
                    ? { ...current, [entry.id]: entry.review }
                    : current)}
                  onChange={(event) => setReviewDrafts((current) => ({
                    ...current,
                    [entry.id]: limitReview(event.target.value),
                  }))}
                  onBlur={() => finishInlineReview(entry)}
                  onDoubleClick={() => openReviewDialog(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "F2") {
                      event.preventDefault();
                      openReviewDialog(entry);
                    } else if (event.key === "Enter") {
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      cancelledInlineReviewIdsRef.current.add(entry.id);
                      setReviewDrafts((current) => {
                        const next = { ...current };
                        delete next[entry.id];
                        return next;
                      });
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder={copy.paperTrading.reviewPlaceholder}
                  aria-label={copy.paperTrading.editReview(entry.no)}
                  aria-busy={savingReviewIds.has(entry.id)}
                  title={(reviewDrafts[entry.id] ?? entry.review) || copy.paperTrading.reviewEditHint}
                  disabled={savingReviewIds.has(entry.id)}
                  className="h-8 min-w-0 truncate border-transparent bg-transparent px-2 pr-8 text-left shadow-none hover:border-slate-300 hover:bg-white focus-visible:bg-white"
                />
                {savingReviewIds.has(entry.id) ? <Loader2 className="pointer-events-none absolute right-2 top-2 h-4 w-4 animate-spin text-slate-500" aria-hidden="true" /> : null}
              </div>
            </td> : null}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    {(scope === "current" || selectedSession) && totalItems > 0 ? <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600">
        {copy.tradeJournals.pagination.page
          .replace("{page}", page.toLocaleString("zh-CN"))
          .replace("{totalPages}", totalPages.toLocaleString("zh-CN"))}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => void load({ sessionId: selectedSession?.id, requestedPage: page - 1, take: pageSize })}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />{copy.tradeJournals.pagination.previous}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={loading || page >= totalPages} onClick={() => void load({ sessionId: selectedSession?.id, requestedPage: page + 1, take: pageSize })}>
          {copy.tradeJournals.pagination.next}<ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div> : null}
    <Dialog
      open={visibleColumnsOpen}
      title={copy.paperTrading.visibleColumnsTitle}
      description={copy.paperTrading.visibleColumnsDescription}
      onClose={() => setVisibleColumnsOpen(false)}
      className="max-w-lg"
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {scopedJournalColumns.map((column) => (
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
        {!scopedJournalColumns.some((column) => draftVisibleColumnIds.includes(column.id)) ? <p className="text-xs text-red-600" role="alert">{copy.paperTrading.visibleColumnsRequired}</p> : null}
        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => setDraftVisibleColumnIds(defaultVisibleColumnIds)}>
            {copy.paperTrading.visibleColumnsReset}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setVisibleColumnsOpen(false)}>{copy.common.cancel}</Button>
            <Button type="button" onClick={applyVisibleColumns} disabled={!scopedJournalColumns.some((column) => draftVisibleColumnIds.includes(column.id))}>
              {copy.paperTrading.visibleColumnsSave}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
    <Dialog
      open={reviewDialogEntryId !== null}
      title={copy.paperTrading.reviewDialogTitle(items.find((entry) => entry.id === reviewDialogEntryId)?.no ?? 0)}
      description={copy.paperTrading.reviewDialogDescription}
      onClose={() => { if (!reviewDialogEntryId || !savingReviewIds.has(reviewDialogEntryId)) setReviewDialogEntryId(null); }}
      className="max-w-2xl"
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveReviewDialog(); }}>
        <div className="space-y-2">
          <Label htmlFor="replay-journal-review">{copy.paperTrading.review}</Label>
          <Textarea
            id="replay-journal-review"
            value={reviewDialogDraft}
            onChange={(event) => setReviewDialogDraft(limitReview(event.target.value))}
            placeholder={copy.paperTrading.reviewPlaceholder}
            className="min-h-64 resize-y"
            disabled={reviewDialogEntryId ? savingReviewIds.has(reviewDialogEntryId) : false}
            aria-describedby="replay-journal-review-count"
            autoFocus
          />
          <div className="flex items-start justify-between gap-3">
            {reviewError ? <p className="text-xs text-red-600" role="alert">{reviewError}</p> : <span />}
            <p id="replay-journal-review-count" className="shrink-0 text-xs text-slate-500">
              {copy.paperTrading.reviewCharacterCount(reviewLength(reviewDialogDraft))}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => setReviewDialogEntryId(null)} disabled={reviewDialogEntryId ? savingReviewIds.has(reviewDialogEntryId) : false}>{copy.common.cancel}</Button>
          <Button type="submit" disabled={reviewDialogEntryId ? savingReviewIds.has(reviewDialogEntryId) : true}>
            {reviewDialogEntryId && savingReviewIds.has(reviewDialogEntryId) ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {copy.paperTrading.saveReview}
          </Button>
        </div>
      </form>
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

function JournalWinRateStat({
  winRate,
  winningTradeCount,
  losingTradeCount,
  breakEvenTradeCount,
}: {
  winRate: string;
  winningTradeCount: number;
  losingTradeCount: number;
  breakEvenTradeCount: number;
}) {
  const counts = [
    {
      label: copy.paperTrading.journalTakeProfitTrades,
      value: winningTradeCount,
      className: "text-emerald-700",
    },
    {
      label: copy.paperTrading.journalStopLossTrades,
      value: losingTradeCount,
      className: "text-red-700",
    },
    {
      label: copy.paperTrading.journalBreakEvenTrades,
      value: breakEvenTradeCount,
      className: "text-slate-700",
    },
  ];

  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <JournalStatValue label={copy.paperTrading.journalWinRate} value={winRate} />
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200 pt-2">
        {counts.map((count) => (
          <div key={count.label} className="min-w-0">
            <p className="truncate text-xs text-slate-500">{count.label}</p>
            <p className={`mt-0.5 truncate text-xs font-semibold tabular-nums ${count.className}`}>
              {copy.paperTrading.journalTradeCountValue(count.value)}
            </p>
          </div>
        ))}
      </div>
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
