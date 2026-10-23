"use client";
import { useDeleteReplayCycle } from "./replay-correction-context";
import { useReplayFetch, useReplaySession, useReplaySessionUrl } from "./replay-session-context";
import { useAiAssistant } from "@/components/ai/assistant-provider";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";










import { type FilterOption } from "@/components/ui/multi-option-filter-popover";





import { MAX_REVIEW_LENGTH, limitReview, reviewLength } from "@/lib/paper-trading/review-templates";

import { copy } from "@/lib/i18n";
import { replayJournalEntryApiHref } from "@/lib/paper-trading/journal-links";


import { clampJournalColumnWidth, minimumJournalTableLeftOffset, normalizeJournalTableWidth, parseStoredJournalColumnWidths, parseStoredJournalTableOffset, parseStoredJournalTableWidth, resizeJournalTableFromStartEdge } from "@/lib/market-replay/journal-column-widths";
import { compileReplayJournalFilters, countActiveReplayJournalFilters, createEmptyReplayJournalFilters, hasActiveReplayJournalFilters, NO_SETUP_FILTER_VALUE, NO_TRADE_REASON_FILTER_VALUE, replayJournalExpressionFilterKeys, type ReplayJournalExpressionFilterKey, type ReplayJournalFilters, type ReplayJournalOptionFilterKey } from "@/lib/paper-trading/journal-filters";
import { journalColumns, journalColumnsForContext, parseJournalVisibleColumns, type JournalColumnId } from "@/lib/paper-trading/journal-columns";

import type { StrategyChecklistItem } from "@/lib/paper-trading/training-gate";
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
  checklist?: StrategyChecklistItem[];
};

type TradeReason = {
  id: string;
  name: string;
};

const defaultVisibleColumnIds = journalColumns.map((column) => column.id);
const defaultColumnWidths = Object.fromEntries(
  journalColumns.map((column) => [column.id, column.defaultWidth]),
) as Record<JournalColumnId, number>;
const columnPreferenceKey = "replay-journal-visible-columns-v2";
const legacyColumnPreferenceKey = "replay-journal-visible-columns-v1";
const columnWidthPreferenceKey = "replay-journal-column-widths-v1";
const tableWidthPreferenceKey = "replay-journal-table-width-v1";
const tableOffsetPreferenceKey = "replay-journal-table-offset-v1";

const noSetupValue = "__NO_SETUP__";








export function usePaperJournalTableController({ datasetId, scope }: {
  datasetId: string; scope: "current" | "history";
}) {
  const fetch = useReplayFetch();
  const replaySession = useReplaySession();
  const ai = useAiAssistant();
  const reviewAiSourcesRef = useRef<Record<string, string>>({});
  const router = useRouter();
  const [switchingSession, startSessionNavigation] = useTransition();
  const correction = useDeleteReplayCycle();
  const canDeleteCycle = Boolean(correction && replaySession?.mode === "LIVE_REPLAY" && replaySession.status === "ACTIVE");
  const scopedUrl = useReplaySessionUrl();
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
  const [reviewDialogInitialValue, setReviewDialogInitialValue] = useState("");
  useEffect(() => {
    if (!ai) return;
    ai.registerEditor((payload) => {
      if (!replaySession || payload.replaySessionId !== replaySession.id || payload.projectionId !== replaySession.activeProjectionId) return false;
      const entry = items.find((e) => e.id === payload.entryId);
      if (!entry) return false;
      const current = reviewDialogEntryId === entry.id ? reviewDialogDraft : reviewDrafts[entry.id] ?? entry.review;
      if (current !== payload.originalDraft) return false;
      reviewAiSourcesRef.current[entry.id] = payload.sourceRunId;
      setReviewDialogInitialValue(current); setReviewDialogEntryId(entry.id); setReviewDialogDraft(payload.draft); setReviewError(null);
      return true;
    });
    return () => ai.registerEditor(null);
  }, [ai, items, replaySession, reviewDialogEntryId, reviewDialogDraft, reviewDrafts]);
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
  const [tableMinimumLeftOffset, setTableMinimumLeftOffset] = useState(0);
  const [resizingTarget, setResizingTarget] = useState<JournalColumnId | "table-start" | "table-end" | null>(null);
  const [disciplineEntry, setDisciplineEntry] = useState<ReplayJournalEntryData | null>(null);
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
        for (const value of appliedFiltersRef.current.checklistUsed) params.append("checklistUsed", value);
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
  }, [datasetId, scope, fetch]);

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
  }, [fetch]);

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
  }, [fetch]);

  useEffect(() => {
    const stored = window.localStorage.getItem(columnPreferenceKey);
    const migrated = parseJournalVisibleColumns(stored ?? window.localStorage.getItem(legacyColumnPreferenceKey), stored === null);
    setVisibleColumnIds(migrated);
    setDraftVisibleColumnIds(migrated);
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
    const updateLayout = () => {
      const containerLeft = tableViewportElement.getBoundingClientRect().left + window.scrollX;
      const minimumOffset = minimumJournalTableLeftOffset(containerLeft);
      setTableViewportWidth(tableViewportElement.clientWidth);
      setTableMinimumLeftOffset(minimumOffset);
      setTableLeftOffset((current) => Math.max(current, minimumOffset));
    };
    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(tableViewportElement);
    window.addEventListener("resize", updateLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateLayout);
    };
  }, [tableViewportElement]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

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
      const response = await fetch(replayJournalEntryApiHref(datasetId, entry.id), {
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
      const response = await fetch(replayJournalEntryApiHref(datasetId, entry.id), {
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
    if (reviewLength(value) > MAX_REVIEW_LENGTH) {
      setReviewError(copy.paperTrading.reviewTooLong);
      return false;
    }
    if (review === entry.review) return true;
    const previousReview = entry.review;

    setReviewError(null);
    setItems((current) => current.map((item) => item.id === entry.id ? { ...item, review } : item));
    setSavingReviewIds((current) => new Set(current).add(entry.id));
    try {
      const response = await fetch(replayJournalEntryApiHref(datasetId, entry.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review, expectedReview: previousReview, expectedProjectionId: replaySession?.activeProjectionId, aiSourceRunId: reviewAiSourcesRef.current[entry.id] }),
      });
      const data = await response.json() as ReplayJournalEntryData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.reviewUpdateFailed);
      setItems((current) => current.map((item) => item.id === entry.id ? { ...item, review: data.review } : item));
      if (announce) setStatus(copy.paperTrading.reviewSaved);
      return true;
    } catch (cause) {
      setItems((current) => current.map((item) => item.id === entry.id ? { ...item, review: previousReview } : item));
      setReviewError(cause instanceof Error ? cause.message : copy.paperTrading.reviewUpdateFailed);
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
    const initialValue = reviewDrafts[entry.id] ?? entry.review;
    setReviewDialogEntryId(entry.id);
    setReviewDialogDraft(initialValue);
    setReviewDialogInitialValue(initialValue);
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
    void updateReview(entry, value).then((saved) => {
      if (!saved) return;
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
      startTableOffset: visibleTableLeftOffset,
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
          minimumOffset: tableMinimumLeftOffset,
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
        startOffset: visibleTableLeftOffset,
        pointerDelta,
        minimumWidth,
        minimumOffset: tableMinimumLeftOffset,
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
  const startRow = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, totalItems);
  const scopedJournalColumns = journalColumnsForContext(scope, replaySession?.mode);
  const visibleColumns = scopedJournalColumns.filter((column) => visibleColumnIds.includes(column.id));
  const visibleColumnSet = new Set(visibleColumns.map((column) => column.id));
  const correctionColumnWidth = canDeleteCycle ? 80 : 0;
  const baseTableWidth = visibleColumns.reduce((total, column) => total + columnWidths[column.id], correctionColumnWidth);
  const visibleTableWidth = Math.max(baseTableWidth, tableViewportWidth, tableWidthPreference ?? 0);
  const visibleTableLeftOffset = Math.max(tableLeftOffset, tableMinimumLeftOffset);
  const distributedTableExtraWidth = visibleColumns.length === 0
    ? 0
    : (visibleTableWidth - baseTableWidth) / visibleColumns.length;
  let accumulatedTableWidth = 0;
  const visibleColumnEdges = visibleColumns.map((column, index) => {
    accumulatedTableWidth += columnWidths[column.id] + distributedTableExtraWidth;
    return {
      column,
      position: accumulatedTableWidth + (index === visibleColumns.length - 1 ? correctionColumnWidth : 0),
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
    checklistUsed: [
      { value: "YES", label: copy.paperTrading.checklistYes },
      { value: "NO", label: copy.paperTrading.checklistNo },
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
  return {
    replaySession, ai, router, switchingSession, startSessionNavigation, correction,
    canDeleteCycle, scopedUrl, items, sessions, page, setPage,
    pageSize, setPageSize, totalItems, totalPages, loading, error,
    status, renameOpen, setRenameOpen, renameDraft, setRenameDraft, renameError,
    renaming, setupOptions, setupOptionsLoading, setupError, savingSetupIds, tradeReasonOptions,
    tradeReasonsLoading, tradeReasonsError, savingTradeReasonIds, reviewDrafts, setReviewDrafts, savingReviewIds,
    reviewError, reviewDialogEntryId, setReviewDialogEntryId, reviewDialogDraft, setReviewDialogDraft, reviewDialogInitialValue,
    visibleColumnsOpen, setVisibleColumnsOpen, draftVisibleColumnIds, setDraftVisibleColumnIds, columnWidths, setTableViewportElement,
    tableViewportWidth, tableMinimumLeftOffset, resizingTarget, disciplineEntry, setDisciplineEntry, summary,
    filterDrafts, appliedFilters, openFilter, setOpenFilter, cancelledInlineReviewIdsRef, load,
    changeExpressionFilter, changeOptionFilter, clearAllExpressionFilters, selectedSession, beginRename, renameSession,
    updateSetup, updateTradeReasons, openReviewDialog, saveReviewDialog, finishInlineReview, openVisibleColumns,
    toggleDraftColumn, applyVisibleColumns, startResize, startTableResize, continueResize, finishResize,
    resizeWithKeyboard, resizeTableEdgeWithKeyboard, startRow, endRow, scopedJournalColumns, visibleColumns,
    visibleColumnSet, correctionColumnWidth, baseTableWidth, visibleTableWidth, visibleTableLeftOffset, distributedTableExtraWidth,
    visibleColumnEdges, activeFilterCount, hasActiveFilters, optionFilters,
  };
}
