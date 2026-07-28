"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Filter, HelpCircle, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { ScreenshotPreviewDialog } from "@/components/trade-journals/screenshot-preview-dialog";
import { JournalTradeBrowser } from "@/components/trade-journals/journal-trade-browser";
import { SqnStatLabel } from "@/components/trade-journals/sqn-stat-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { calculateJournalStats } from "@/lib/trade-journal/calculations";
import { compileRExpressionFilter } from "@/lib/trade-journal/r-expression-filter";
import { getTradeScreenshotUrl } from "@/lib/trade-journal/screenshot-url";
import {
  evaluateStrategyCode,
  normalizeStrategyCode,
  validateStrategyCode,
  type StrategyCodeStatus,
} from "@/lib/trade-journal/strategy-code";
import {
  compileStrategyCodeRegex,
  MAX_STRATEGY_CODE_REGEX_LENGTH,
  STRATEGY_CODE_FAIL_REGEX,
  STRATEGY_CODE_PASS_REGEX,
  type StrategyCodeRegexFilter,
} from "@/lib/trade-journal/strategy-code-filter";
import { matchesAnyTag, type TradeTagValue } from "@/lib/trade-journal/tags";
import { cn } from "@/lib/utils";

export type TradeOption = {
  id: string;
  type: "INSTRUMENT" | "STRATEGY";
  name: string;
  active: boolean;
};

export type JournalTradeRow = {
  id: string;
  date: string;
  direction: string | null;
  riskAmount: number | null;
  rMultiple: number;
  instrumentOptionId: string | null;
  strategyOptionId: string | null;
  instrumentOption: { name: string } | null;
  strategyOption: { name: string } | null;
  entryPrice: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  strategyCode: string | null;
  screenshotPath: string | null;
  tags: TradeTagValue[];
};

type Draft = {
  date: string;
  instrumentOptionId: string;
  strategyOptionId: string;
  entryPrice: string;
  stopLossPrice: string;
  riskAmount: string;
  targetPrice: string;
  exitPrice: string;
  strategyCode: string;
  screenshot: File | null;
};

type SortKey = "date" | "rMultiple";
type SortDirection = "asc" | "desc";
type SortState = {
  key: SortKey;
  direction: SortDirection;
};
type DirectionFilter = "ALL" | "LONG" | "SHORT";
type Filters = {
  instrumentOptionId: string;
  strategyOptionIds: string[];
  tagIds: string[];
  direction: DirectionFilter;
  dateFrom: string;
  dateTo: string;
  rExpression: string;
  strategyCodeRegex: string;
};

const emptyDraft: Draft = {
  date: "",
  instrumentOptionId: "",
  strategyOptionId: "",
  entryPrice: "",
  stopLossPrice: "",
  riskAmount: "",
  targetPrice: "",
  exitPrice: "",
  strategyCode: "",
  screenshot: null,
};

const pageSizeOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 10);
const acceptedScreenshotTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allFilterValue = "ALL";
const defaultSortDirections: Record<SortKey, SortDirection> = {
  date: "asc",
  rMultiple: "desc",
};
const emptyFilters: Filters = {
  instrumentOptionId: allFilterValue,
  strategyOptionIds: [],
  tagIds: [],
  direction: allFilterValue,
  dateFrom: "",
  dateTo: "",
  rExpression: "",
  strategyCodeRegex: "",
};

export function JournalTradeTable({
  journalId,
  trades,
  options,
  tags,
  viewMode,
  onEditingChange,
}: {
  journalId: string;
  trades: JournalTradeRow[];
  options: TradeOption[];
  tags: TradeTagValue[];
  viewMode: "table" | "browse";
  onEditingChange: (isEditing: boolean) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(trades);
  const [tagOptions, setTagOptions] = useState(tags);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTradeId, setDeleteTradeId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewScreenshot, setPreviewScreenshot] = useState<{
    url: string;
    tags: TradeTagValue[];
  } | null>(null);
  const [browseTradeId, setBrowseTradeId] = useState<string | null>(null);
  const [highlightedTradeId, setHighlightedTradeId] = useState<string | null>(null);
  const [hiddenNewTradeId, setHiddenNewTradeId] = useState<string | null>(null);
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "asc" });
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [showStrategyCode, setShowStrategyCode] = useState(true);
  const instruments = options.filter((option) => option.type === "INSTRUMENT");
  const strategies = options.filter((option) => option.type === "STRATEGY");
  const instrumentFilterOptions = useMemo(() => buildTradeOptionFilters(rows, "instrument"), [rows]);
  const strategyFilterOptions = useMemo(() => buildTradeOptionFilters(rows, "strategy"), [rows]);
  const tagFilterOptions = useMemo(() => buildTradeTagFilters(rows), [rows]);
  const hasActiveFilters = !areFiltersEmpty(filters);

  useEffect(() => setRows(trades), [trades]);
  useEffect(() => setTagOptions(tags), [tags]);

  useEffect(() => {
    onEditingChange(editingId !== null);
  }, [editingId, onEditingChange]);

  const filteredRows = useMemo(() => getVisibleRows(rows, filters), [filters, rows]);
  const sortedRows = useMemo(() => getSortedRows(filteredRows, sort), [filteredRows, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const filteredStats = useMemo(
    () => calculateJournalStats(filteredRows.map((trade) => trade.rMultiple)),
    [filteredRows],
  );

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!highlightedTradeId) return;
    highlightedRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timeout = window.setTimeout(() => setHighlightedTradeId(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [highlightedTradeId, page]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [page, pageSize, sortedRows]);

  const startRow = filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, filteredRows.length);

  function beginCreate() {
    setDraft(emptyDraft);
    setEditingId("new");
    setError(null);
  }

  function changeSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key
        ? current.direction === "asc" ? "desc" : "asc"
        : defaultSortDirections[key],
    }));
    setPage(1);
  }

  function setFilter<Key extends keyof Filters>(key: Key, value: Filters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function resetFilters() {
    setFilters(emptyFilters);
    setOpenFilter(null);
    setPage(1);
    setHiddenNewTradeId(null);
  }

  function toggleStrategyCodeVisibility() {
    if (showStrategyCode && editingId !== null) {
      const validation = validateStrategyCode(draft.strategyCode);
      if (!validation.valid) {
        setError(validation.error);
        return;
      }
    }

    setError(null);
    setShowStrategyCode((current) => !current);
    setOpenFilter(null);
    if (showStrategyCode) {
      setFilter("strategyCodeRegex", "");
    }
  }

  function updateTradeTags(tradeId: string, nextTags: TradeTagValue[]) {
    setRows((currentRows) =>
      currentRows.map((trade) => trade.id === tradeId ? { ...trade, tags: nextTags } : trade),
    );
    setTagOptions((currentTags) => {
      const tagsById = new Map(currentTags.map((tag) => [tag.id, tag]));
      nextTags.forEach((tag) => tagsById.set(tag.id, tag));
      return Array.from(tagsById.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    });
  }

  function beginEdit(trade: JournalTradeRow) {
    setDraft({
      date: trade.date,
      instrumentOptionId: trade.instrumentOptionId ?? "",
      strategyOptionId: trade.strategyOptionId ?? "",
      entryPrice: trade.entryPrice === null ? "" : String(trade.entryPrice),
      stopLossPrice: trade.stopLossPrice === null ? "" : String(trade.stopLossPrice),
      riskAmount: trade.riskAmount === null ? "" : String(trade.riskAmount),
      targetPrice: trade.targetPrice === null ? "" : String(trade.targetPrice),
      exitPrice: trade.exitPrice === null ? "" : String(trade.exitPrice),
      strategyCode: trade.strategyCode ?? "",
      screenshot: null,
    });
    setEditingId(trade.id);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft);
    setError(null);
  }

  async function saveTrade() {
    setError(null);
    setHiddenNewTradeId(null);
    const strategyCodeValidation = validateStrategyCode(draft.strategyCode);
    if (!strategyCodeValidation.valid) {
      setError(strategyCodeValidation.error);
      return;
    }
    if (editingId === "new" && !draft.screenshot) {
      setError(copy.tradeJournals.screenshotRequired);
      return;
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries(draft)) {
      if (value !== null) formData.set(key, value);
    }
    formData.set("strategyCode", strategyCodeValidation.normalized);

    setIsSaving(true);
    const isNew = editingId === "new";
    const response = await fetch(
      isNew ? `/api/trade-journals/${journalId}/trades` : `/api/trade-journals/${journalId}/trades/${editingId}`,
      { method: isNew ? "POST" : "PUT", body: formData },
    );
    const data = await response.json();
    setIsSaving(false);
    if (!response.ok) {
      setError(data.error ?? copy.tradeJournals.saveError);
      return;
    }

    const row = serializeApiTrade(data);
    const nextRows = isNew ? [...rows, row] : rows.map((trade) => trade.id === row.id ? row : trade);
    setRows(nextRows);
    if (isNew) {
      const nextSortedRows = getSortedRows(getVisibleRows(nextRows, filters), sort);
      const newTradeIndex = nextSortedRows.findIndex((trade) => trade.id === row.id);
      if (newTradeIndex >= 0) {
        setPage(Math.floor(newTradeIndex / pageSize) + 1);
        setHighlightedTradeId(row.id);
      } else {
        setHiddenNewTradeId(row.id);
      }
    }
    cancelEdit();
    router.refresh();
  }

  async function deleteTrade() {
    if (!deleteTradeId) return;
    setIsDeleting(true);
    const response = await fetch(`/api/trade-journals/${journalId}/trades/${deleteTradeId}`, { method: "DELETE" });
    setIsDeleting(false);
    if (response.ok) {
      setRows((current) => current.filter((trade) => trade.id !== deleteTradeId));
      setDeleteTradeId(null);
      router.refresh();
    }
  }

  async function exportFilteredRows() {
    setError(null);
    setIsExporting(true);
    const response = await fetch(`/api/trade-journals/${journalId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeIds: sortedRows.map((trade) => trade.id) }),
    });
    setIsExporting(false);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? copy.tradeJournals.exportFilteredError);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trade-journal-${journalId}-filtered.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {viewMode === "table" ? copy.tradeJournals.detailDescription : copy.tradeJournals.browser.description}
        </p>
        {viewMode === "table" ? (
          <Button
            type="button"
            size="sm"
            onClick={beginCreate}
            disabled={editingId !== null || !instruments.some((option) => option.active) || !strategies.some((option) => option.active)}
          >
            <Plus className="h-4 w-4" />
            {copy.tradeJournals.addTrade}
          </Button>
        ) : null}
      </div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {hiddenNewTradeId ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <span>{copy.tradeJournals.newTradeHiddenByFilters}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-blue-200 bg-white px-2 text-xs text-blue-700 hover:bg-blue-100"
            onClick={resetFilters}
            disabled={editingId !== null}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {copy.tradeJournals.filters.reset}
          </Button>
        </div>
      ) : null}
      {hasActiveFilters ? (
        <div className="rounded-lg border bg-slate-50/70 p-3">
          <div className="mb-2 text-sm font-medium text-slate-700">{copy.tradeJournals.filteredStatistics}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            <FilteredStat label={copy.tradeJournals.statTradeCount} value={String(filteredStats.tradeCount)} />
            <FilteredStat label={copy.tradeJournals.statWinRate} value={formatPercent(filteredStats.winRate)} />
            <FilteredStat label={copy.tradeJournals.statTotalR} value={`${formatNumber(filteredStats.totalR)} R`} />
            <FilteredStat label={copy.tradeJournals.statAverageR} value={`${formatNumber(filteredStats.averageR)} R`} />
            <FilteredStat
              label={<SqnStatLabel sqn={filteredStats.sqn} tradeCount={filteredStats.tradeCount} />}
              value={filteredStats.sqn === null ? copy.common.dash : formatNumber(filteredStats.sqn)}
            />
            <FilteredStat label={copy.tradeJournals.statMedianR} value={`${formatNumber(filteredStats.medianR)} R`} />
            <FilteredStat label={copy.tradeJournals.statMaxLosingStreak} value={String(filteredStats.maxLosingStreak)} />
          </div>
        </div>
      ) : null}
      {viewMode === "table" ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          {copy.tradeJournals.pagination.range
            .replace("{start}", startRow.toLocaleString("zh-CN"))
            .replace("{end}", endRow.toLocaleString("zh-CN"))
            .replace("{total}", filteredRows.length.toLocaleString("zh-CN"))}
          {hasActiveFilters ? (
            <span className="ml-2 text-slate-500">
              {copy.tradeJournals.filters.filteredFrom.replace("{total}", rows.length.toLocaleString("zh-CN"))}
            </span>
          ) : null}
          {hasActiveFilters ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-2 h-7 px-2 text-xs"
              onClick={resetFilters}
              disabled={editingId !== null}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {copy.tradeJournals.filters.reset}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={toggleStrategyCodeVisibility}
          >
            {showStrategyCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showStrategyCode
              ? copy.tradeJournals.hideStrategyCode
              : copy.tradeJournals.showStrategyCode}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={exportFilteredRows}
            disabled={editingId !== null || isExporting || sortedRows.length === 0}
          >
            <Download className="h-4 w-4" />
            {copy.tradeJournals.exportFiltered}
          </Button>
          <span className="text-sm text-slate-600">{copy.tradeJournals.pagination.rowsPerPage}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
            disabled={editingId !== null}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Table
        className={cn(
          "[&_td]:px-2 [&_th]:px-2",
          editingId
            ? showStrategyCode ? "min-w-[1840px]" : "min-w-[1500px]"
            : showStrategyCode ? "min-w-[1680px] table-fixed" : "min-w-[1420px] table-fixed",
        )}
      >
        <TableHeader>
          <TableRow>
            <SortableHead
              label={copy.tradeJournals.table.date}
              sortKey="date"
              activeSort={sort}
              onSort={changeSort}
              disabled={editingId !== null}
              filter={
                <ColumnFilterPopover
                  id="date"
                  openFilter={openFilter}
                  setOpenFilter={setOpenFilter}
                  active={filters.dateFrom !== "" || filters.dateTo !== ""}
                  label={copy.tradeJournals.filters.dateRange}
                  disabled={editingId !== null}
                >
                  <DateFilterPanel
                    dateFrom={filters.dateFrom}
                    dateTo={filters.dateTo}
                    onDateFromChange={(value) => setFilter("dateFrom", value)}
                    onDateToChange={(value) => setFilter("dateTo", value)}
                    onClear={() => {
                      setFilter("dateFrom", "");
                      setFilter("dateTo", "");
                    }}
                  />
                </ColumnFilterPopover>
              }
            />
            <FilterableHead
              label={copy.tradeJournals.table.instrument}
              filterId="instrument"
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
              active={filters.instrumentOptionId !== allFilterValue}
              disabled={editingId !== null}
            >
              <OptionFilterPanel
                value={filters.instrumentOptionId}
                options={[
                  { value: allFilterValue, label: copy.tradeJournals.filters.allInstruments },
                  ...instrumentFilterOptions.map((option) => ({ value: option.id, label: option.name })),
                ]}
                onChange={(value) => setFilter("instrumentOptionId", value)}
                onClear={() => setFilter("instrumentOptionId", allFilterValue)}
              />
            </FilterableHead>
            <FilterableHead
              label={copy.tradeJournals.table.strategy}
              filterId="strategy"
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
              active={filters.strategyOptionIds.length > 0}
              disabled={editingId !== null}
            >
              <MultiOptionFilterPanel
                values={filters.strategyOptionIds}
                allLabel={copy.tradeJournals.filters.allStrategies}
                options={strategyFilterOptions.map((option) => ({ value: option.id, label: option.name }))}
                onChange={(values) => setFilter("strategyOptionIds", values)}
                onClear={() => setFilter("strategyOptionIds", [])}
              />
            </FilterableHead>
            {showStrategyCode ? (
              <FilterableHead
                label={copy.tradeJournals.table.strategyCode}
                filterId="strategy-code"
                openFilter={openFilter}
                setOpenFilter={setOpenFilter}
                active={filters.strategyCodeRegex.trim() !== ""}
                disabled={editingId !== null}
                className="w-64"
              >
                <StrategyCodeRegexFilterPanel
                  expression={filters.strategyCodeRegex}
                  onExpressionChange={(value) => setFilter("strategyCodeRegex", value)}
                  onClear={() => setFilter("strategyCodeRegex", "")}
                />
              </FilterableHead>
            ) : null}
            <FilterableHead
              label={copy.tradeJournals.table.direction}
              filterId="direction"
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
              active={filters.direction !== "ALL"}
              disabled={editingId !== null}
            >
              <OptionFilterPanel
                value={filters.direction}
                options={[
                  { value: "ALL", label: copy.tradeJournals.filters.allDirections },
                  { value: "LONG", label: copy.tradeJournals.table.long },
                  { value: "SHORT", label: copy.tradeJournals.table.short },
                ]}
                onChange={(value) => setFilter("direction", value as DirectionFilter)}
                onClear={() => setFilter("direction", "ALL")}
              />
            </FilterableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.entry}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.stop}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.risk}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.target}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.exit}</TableHead>
            <SortableHead
              label={copy.tradeJournals.table.r}
              sortKey="rMultiple"
              activeSort={sort}
              onSort={changeSort}
              className="text-right"
              disabled={editingId !== null}
              filter={
                <ColumnFilterPopover
                  id="r"
                  openFilter={openFilter}
                  setOpenFilter={setOpenFilter}
                  active={isRFilterActive(filters)}
                  label={copy.tradeJournals.filters.rMode}
                  disabled={editingId !== null}
                >
                  <RFilterPanel
                    expression={filters.rExpression}
                    onExpressionChange={(value) => setFilter("rExpression", value)}
                    onClear={() => setFilter("rExpression", "")}
                  />
                </ColumnFilterPopover>
              }
            />
            <FilterableHead
              label={copy.tradeJournals.table.screenshot}
              filterLabel={copy.tradeJournals.table.tags}
              filterId="tags"
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
              active={filters.tagIds.length > 0}
              disabled={editingId !== null}
              className="w-28 min-w-28"
            >
              <MultiOptionFilterPanel
                values={filters.tagIds}
                allLabel={copy.tradeJournals.filters.allTags}
                options={tagFilterOptions.map((tag) => ({ value: tag.id, label: tag.name }))}
                onChange={(values) => setFilter("tagIds", values)}
                onClear={() => setFilter("tagIds", [])}
              />
            </FilterableHead>
            <TableHead className="sticky right-0 z-20 min-w-40 border-l bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
              {copy.tradeJournals.table.actions}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {editingId === "new" ? <EditableRow draft={draft} setDraft={setDraft} options={options} showStrategyCode={showStrategyCode} onSave={saveTrade} onCancel={cancelEdit} loading={isSaving} /> : null}
          {pagedRows.map((trade) =>
            editingId === trade.id ? (
              <EditableRow key={trade.id} draft={draft} setDraft={setDraft} options={options} showStrategyCode={showStrategyCode} onSave={saveTrade} onCancel={cancelEdit} loading={isSaving} />
            ) : (
              <TableRow
                ref={trade.id === highlightedTradeId ? highlightedRowRef : undefined}
                key={trade.id}
                className={cn(
                  "transition-colors duration-500",
                  trade.rMultiple > 0 && "bg-emerald-50/70 hover:bg-emerald-100/70",
                  trade.rMultiple < 0 && "bg-red-50/70 hover:bg-red-100/70",
                  trade.id === highlightedTradeId && "bg-blue-50 ring-2 ring-inset ring-blue-300 hover:bg-blue-50",
                )}
              >
                <TableCell className="whitespace-nowrap">{trade.date}</TableCell>
                <TableCell className="truncate" title={trade.instrumentOption?.name ?? undefined}>{trade.instrumentOption?.name ?? copy.common.dash}</TableCell>
                <TableCell className="truncate" title={trade.strategyOption?.name ?? undefined}>{trade.strategyOption?.name ?? copy.common.dash}</TableCell>
                {showStrategyCode ? (
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate whitespace-nowrap font-mono text-xs"
                        title={trade.strategyCode ?? undefined}
                      >
                        {trade.strategyCode ?? copy.common.dash}
                      </span>
                      <StrategyCodeBadge status={evaluateStrategyCode(trade.strategyCode).status} />
                    </div>
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap">{trade.direction === "LONG" ? copy.tradeJournals.table.long : copy.tradeJournals.table.short}</TableCell>
                <PriceCell value={trade.entryPrice} />
                <PriceCell value={trade.stopLossPrice} />
                <TableCell className="text-right">{trade.riskAmount === null ? copy.common.dash : formatMoney(trade.riskAmount)}</TableCell>
                <PriceCell value={trade.targetPrice} />
                <PriceCell value={trade.exitPrice} />
                <TableCell
                  className={cn(
                    "text-right font-mono font-medium",
                    trade.rMultiple > 0 && "text-emerald-700",
                    trade.rMultiple < 0 && "text-red-700",
                  )}
                >
                  {formatNumber(trade.rMultiple)}
                </TableCell>
                <TableCell className="w-28 min-w-28">
                  {trade.screenshotPath ? (
                    <button
                      type="button"
                      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setPreviewScreenshot({
                        url: getTradeScreenshotUrl(journalId, trade.id, trade.screenshotPath),
                        tags: trade.tags,
                      })}
                      aria-label={copy.tradeJournals.previewScreenshot}
                    >
                      <Image
                        src={getTradeScreenshotUrl(journalId, trade.id, trade.screenshotPath)}
                        alt={copy.tradeJournals.table.screenshot}
                        width={72}
                        height={44}
                        unoptimized
                        className="h-11 w-[72px] rounded border object-cover"
                      />
                    </button>
                  ) : copy.common.dash}
                </TableCell>
                <TableCell
                  className={cn(
                    "sticky right-0 z-10 min-w-40 border-l bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]",
                    trade.rMultiple > 0 && "bg-emerald-50",
                    trade.rMultiple < 0 && "bg-red-50",
                    trade.id === highlightedTradeId && "bg-blue-50",
                  )}
                >
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      onClick={() => beginEdit(trade)}
                      disabled={editingId !== null}
                      aria-label={copy.tradeJournals.edit}
                      title={copy.tradeJournals.edit}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      onClick={() => setDeleteTradeId(trade.id)}
                      disabled={editingId !== null}
                      aria-label={copy.tradeJournals.deleteTrade}
                      title={copy.tradeJournals.deleteTrade}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      {rows.length === 0 && editingId !== "new" ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">{copy.datasets.noTrades}</p>
      ) : null}
      {rows.length > 0 && filteredRows.length === 0 && editingId !== "new" ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">{copy.tradeJournals.filters.noResults}</p>
      ) : null}
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          {copy.tradeJournals.pagination.page
            .replace("{page}", page.toLocaleString("zh-CN"))
            .replace("{totalPages}", totalPages.toLocaleString("zh-CN"))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={editingId !== null || page <= 1}
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            {copy.tradeJournals.pagination.previous}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={editingId !== null || page >= totalPages}
            onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
          >
            {copy.tradeJournals.pagination.next}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
          </div>
        </>
      ) : (
        <JournalTradeBrowser
          journalId={journalId}
          trades={sortedRows}
          currentTradeId={browseTradeId}
          onCurrentTradeChange={setBrowseTradeId}
          availableTags={tagOptions}
          onTradeTagsChange={updateTradeTags}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTradeId)}
        title={copy.tradeJournals.deleteTradeTitle}
        description={copy.tradeJournals.deleteTradeConfirm}
        confirmLabel={copy.tradeJournals.deleteTrade}
        isLoading={isDeleting}
        onCancel={() => setDeleteTradeId(null)}
        onConfirm={deleteTrade}
      />
      <ScreenshotPreviewDialog
        screenshotUrl={previewScreenshot?.url ?? null}
        tags={previewScreenshot?.tags ?? []}
        onClose={() => setPreviewScreenshot(null)}
      />
    </div>
  );
}

function FilterableHead({
  label,
  filterLabel,
  filterId,
  openFilter,
  setOpenFilter,
  active,
  disabled,
  className,
  children,
}: {
  label: string;
  filterLabel?: string;
  filterId: string;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  active: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableHead className={className}>
      <div className="flex items-center gap-1">
        <span className="truncate">{label}</span>
        <ColumnFilterPopover
          id={filterId}
          openFilter={openFilter}
          setOpenFilter={setOpenFilter}
          active={active}
          label={filterLabel ?? label}
          disabled={disabled}
        >
          {children}
        </ColumnFilterPopover>
      </div>
    </TableHead>
  );
}

function ColumnFilterPopover({
  id,
  openFilter,
  setOpenFilter,
  active,
  label,
  disabled,
  children,
}: {
  id: string;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  active: boolean;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const isOpen = openFilter === id;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);

  function updatePanelPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const panelWidth = 288;
    const viewportPadding = 12;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
    setPanelPosition({ left, top: rect.bottom + 6 });
  }

  useEffect(() => {
    if (!isOpen) return;

    updatePanelPosition();

    function handleViewportChange() {
      updatePanelPosition();
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (target instanceof Element && target.closest("[data-date-picker-popover]")) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpenFilter((current) => current === id ? null : current);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenFilter((current) => current === id ? null : current);
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [id, isOpen, setOpenFilter]);

  return (
    <div className="relative inline-flex">
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
            (active || isOpen) && "bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800",
          )}
          disabled={disabled}
          aria-label={copy.tradeJournals.filters.openColumnFilter.replace("{field}", label)}
          title={copy.tradeJournals.filters.openColumnFilter.replace("{field}", label)}
          aria-expanded={isOpen}
          onClick={() => {
            updatePanelPosition();
            setOpenFilter((current) => current === id ? null : id);
          }}
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
      {isOpen && panelPosition && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] w-72 rounded-md border bg-white p-3 text-slate-950 shadow-lg"
            style={{ left: panelPosition.left, top: panelPosition.top }}
          >
            {children}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

function OptionFilterPanel({
  value,
  options,
  onChange,
  onClear,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.chooseValue}</p>
      <div className="max-h-64 overflow-auto rounded-md border p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100",
              option.value === value && "font-medium text-slate-950",
            )}
            onClick={() => onChange(option.value)}
          >
            <Check className={cn("h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")} />
            <span className="truncate">{option.label}</span>
          </button>
        ))}
      </div>
      <ClearColumnButton onClick={onClear} disabled={value === allFilterValue} />
    </div>
  );
}

function MultiOptionFilterPanel({
  values,
  allLabel,
  options,
  onChange,
  onClear,
}: {
  values: string[];
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
  onClear: () => void;
}) {
  const selected = new Set(values);

  function toggle(value: string) {
    if (selected.has(value)) {
      onChange(values.filter((current) => current !== value));
      return;
    }

    onChange([...values, value]);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.chooseValue}</p>
      <div className="max-h-64 overflow-auto rounded-md border p-1">
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100",
            values.length === 0 && "font-medium text-slate-950",
          )}
          onClick={onClear}
        >
          <span
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              values.length === 0 ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent",
            )}
          >
            <Check className="h-3 w-3" />
          </span>
          <span className="truncate">{allLabel}</span>
        </button>
        {options.map((option) => {
          const isSelected = selected.has(option.value);

          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100",
                isSelected && "font-medium text-slate-950",
              )}
              onClick={() => toggle(option.value)}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  isSelected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent",
                )}
              >
                <Check className="h-3 w-3" />
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
      <ClearColumnButton onClick={onClear} disabled={values.length === 0} />
    </div>
  );
}

function DateFilterPanel({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.dateRange}</p>
      <div className="space-y-2">
        <FilterPanelField label={copy.tradeJournals.filters.dateFrom}>
          <DatePicker value={dateFrom} onChange={onDateFromChange} className="h-9 w-full justify-start" />
        </FilterPanelField>
        <FilterPanelField label={copy.tradeJournals.filters.dateTo}>
          <DatePicker value={dateTo} onChange={onDateToChange} className="h-9 w-full justify-start" />
        </FilterPanelField>
      </div>
      <ClearColumnButton onClick={onClear} disabled={dateFrom === "" && dateTo === ""} />
    </div>
  );
}

function RFilterPanel({
  expression,
  onExpressionChange,
  onClear,
}: {
  expression: string;
  onExpressionChange: (value: string) => void;
  onClear: () => void;
}) {
  const compiled = useMemo(() => compileRExpressionFilter(expression), [expression]);
  const hasError = expression.trim() !== "" && compiled.error !== null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.rMode}</p>
        <div className="group relative">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={copy.tradeJournals.filters.rExpressionHelpTitle}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <div className="pointer-events-none absolute right-0 top-8 z-[160] hidden w-72 rounded-md border bg-white p-3 text-xs leading-5 text-slate-600 shadow-lg group-hover:block group-focus-within:block">
            <div className="mb-1 font-medium text-slate-950">{copy.tradeJournals.filters.rExpressionHelpTitle}</div>
            <p>{copy.tradeJournals.filters.rExpressionHelpVariable}</p>
            <p>{copy.tradeJournals.filters.rExpressionHelpOperators}</p>
            <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-700">
              {copy.tradeJournals.filters.rExpressionExamples.map((example) => (
                <div key={example}>{example}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <FilterPanelField label={copy.tradeJournals.filters.rExpression}>
        <div className="space-y-1">
          <Input
            value={expression}
            onChange={(event) => onExpressionChange(event.target.value)}
            placeholder={copy.tradeJournals.filters.rExpressionPlaceholder}
            className={cn("h-9 font-mono", hasError && "border-red-300 focus-visible:ring-red-100")}
            aria-invalid={hasError}
          />
          {hasError ? (
            <p className="text-xs text-red-600">{copy.tradeJournals.filters.rExpressionError}</p>
          ) : null}
        </div>
      </FilterPanelField>
      <ClearColumnButton onClick={onClear} disabled={expression.trim() === ""} />
    </div>
  );
}

function StrategyCodeRegexFilterPanel({
  expression,
  onExpressionChange,
  onClear,
}: {
  expression: string;
  onExpressionChange: (value: string) => void;
  onClear: () => void;
}) {
  const compiled = useMemo(() => compileStrategyCodeRegex(expression), [expression]);
  const hasError = expression.trim() !== "" && compiled.error !== null;
  const errorMessage = compiled.error === "TOO_LONG"
    ? copy.tradeJournals.filters.strategyCodeRegexTooLong
    : copy.tradeJournals.filters.strategyCodeRegexError;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.strategyCodeRegex}</p>
        <p className="mt-1 text-xs text-slate-500">{copy.tradeJournals.filters.strategyCodeRegexHint}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">
          {copy.tradeJournals.filters.strategyCodeQuickFilters}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={expression.trim() === STRATEGY_CODE_FAIL_REGEX ? "secondary" : "outline"}
            className="h-8 px-2 text-xs"
            aria-pressed={expression.trim() === STRATEGY_CODE_FAIL_REGEX}
            onClick={() => onExpressionChange(STRATEGY_CODE_FAIL_REGEX)}
          >
            {copy.tradeJournals.filters.strategyCodeQuickFail}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={expression.trim() === STRATEGY_CODE_PASS_REGEX ? "secondary" : "outline"}
            className="h-8 px-2 text-xs"
            aria-pressed={expression.trim() === STRATEGY_CODE_PASS_REGEX}
            onClick={() => onExpressionChange(STRATEGY_CODE_PASS_REGEX)}
          >
            {copy.tradeJournals.filters.strategyCodeQuickPass}
          </Button>
        </div>
      </div>
      <Input
        value={expression}
        onChange={(event) => onExpressionChange(event.target.value)}
        placeholder={copy.tradeJournals.filters.strategyCodeRegexPlaceholder}
        maxLength={MAX_STRATEGY_CODE_REGEX_LENGTH + 1}
        className={cn("h-9 font-mono", hasError && "border-red-300 focus-visible:ring-red-100")}
        aria-invalid={hasError}
      />
      {hasError ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
      <ClearColumnButton onClick={onClear} disabled={expression.trim() === ""} />
    </div>
  );
}

function FilterPanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ClearColumnButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onClick} disabled={disabled}>
      <RotateCcw className="h-3.5 w-3.5" />
      {copy.tradeJournals.filters.clearColumn}
    </Button>
  );
}

function SortableHead({
  label,
  sortKey,
  activeSort,
  onSort,
  className,
  disabled,
  filter,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
  disabled?: boolean;
  filter?: React.ReactNode;
}) {
  const isActive = activeSort.key === sortKey;
  const currentDirection = isActive ? activeSort.direction : null;
  const nextDirection = isActive && activeSort.direction === "asc" ? "desc" : defaultSortDirections[sortKey];
  const Icon = currentDirection === "asc" ? ArrowUp : currentDirection === "desc" ? ArrowDown : ArrowUpDown;
  const title = (nextDirection === "asc" ? copy.tradeJournals.sortAscending : copy.tradeJournals.sortDescending)
    .replace("{field}", label);

  return (
    <TableHead
      className={className}
      aria-sort={currentDirection === "asc" ? "ascending" : currentDirection === "desc" ? "descending" : "none"}
    >
      <div className={cn("flex items-center gap-1", className?.includes("text-right") && "justify-end")}>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
            isActive && "text-slate-950",
          )}
          onClick={() => onSort(sortKey)}
          disabled={disabled}
          aria-label={title}
          title={title}
        >
          <span>{label}</span>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {filter}
      </div>
    </TableHead>
  );
}

function EditableRow({
  draft,
  setDraft,
  options,
  showStrategyCode,
  onSave,
  onCancel,
  loading,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  options: TradeOption[];
  showStrategyCode: boolean;
  onSave: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const strategyCodeValidation = useMemo(() => validateStrategyCode(draft.strategyCode), [draft.strategyCode]);

  function setField<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <TableRow className="bg-blue-50/50 align-top">
      <TableCell><DatePicker value={draft.date} onChange={(value) => setField("date", value)} /></TableCell>
      <TableCell><OptionSelect value={draft.instrumentOptionId} onChange={(value) => setField("instrumentOptionId", value)} options={options.filter((option) => option.type === "INSTRUMENT")} placeholder={copy.tradeJournals.chooseInstrument} /></TableCell>
      <TableCell><OptionSelect value={draft.strategyOptionId} onChange={(value) => setField("strategyOptionId", value)} options={options.filter((option) => option.type === "STRATEGY")} placeholder={copy.tradeJournals.chooseStrategy} /></TableCell>
      {showStrategyCode ? (
        <TableCell>
          <StrategyCodeInput
            value={draft.strategyCode}
            onChange={(value) => setField("strategyCode", value)}
            onBlur={() => setField("strategyCode", normalizeStrategyCode(draft.strategyCode))}
          />
        </TableCell>
      ) : null}
      <TableCell className="text-slate-400">{copy.common.dash}</TableCell>
      <NumberInput value={draft.entryPrice} onChange={(value) => setField("entryPrice", value)} />
      <NumberInput value={draft.stopLossPrice} onChange={(value) => setField("stopLossPrice", value)} />
      <NumberInput value={draft.riskAmount} onChange={(value) => setField("riskAmount", value)} />
      <NumberInput value={draft.targetPrice} onChange={(value) => setField("targetPrice", value)} />
      <NumberInput value={draft.exitPrice} onChange={(value) => setField("exitPrice", value)} />
      <TableCell className="text-right text-slate-400">{copy.common.dash}</TableCell>
      <TableCell><ScreenshotInput value={draft.screenshot} onChange={(value) => setField("screenshot", value)} /></TableCell>
      <TableCell className="sticky right-0 z-10 min-w-40 border-l bg-blue-50 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
        <div className="flex gap-1">
          <Button type="button" size="sm" onClick={onSave} disabled={loading || !strategyCodeValidation.valid}><Check className="h-4 w-4" />{copy.tradeJournals.save}</Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={loading}><X className="h-4 w-4" />{copy.tradeJournals.cancel}</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function StrategyCodeInput({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const validation = useMemo(() => validateStrategyCode(value), [value]);
  const evaluation = validation.valid ? evaluateStrategyCode(validation.normalized) : null;

  return (
    <div className="w-80 space-y-2">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={copy.tradeJournals.strategyCodePlaceholder}
        className={cn("font-mono uppercase", !validation.valid && "border-red-300 focus-visible:ring-red-100")}
        aria-invalid={!validation.valid}
      />
      <div className="rounded-md border bg-white p-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-slate-500">
            {copy.tradeJournals.strategyCodeNormalized}：
            <span className="ml-1 font-mono text-slate-800">
              {validation.normalized || copy.common.dash}
            </span>
          </span>
          {evaluation ? <StrategyCodeBadge status={evaluation.status} /> : null}
          {evaluation ? (
            <span className="text-slate-600">
              {copy.tradeJournals.strategyCodeBCount}：{evaluation.bCount}
            </span>
          ) : null}
          {evaluation ? (
            <span className="text-slate-600">
              {copy.tradeJournals.strategyCodeCItems}：
              {evaluation.cKeys.length > 0 ? evaluation.cKeys.join("、") : copy.tradeJournals.strategyCodeNone}
            </span>
          ) : null}
        </div>
        {!validation.valid ? <p className="mt-1 text-red-600">{validation.error}</p> : null}
        {evaluation ? <p className="mt-1 text-slate-500">{evaluation.reason}</p> : null}
        {evaluation?.status === "FAIL" ? (
          <p className="mt-1 font-medium text-red-700">{copy.tradeJournals.strategyCodeFailWarning}</p>
        ) : null}
      </div>
    </div>
  );
}

function StrategyCodeBadge({ status }: { status: StrategyCodeStatus }) {
  const label = status === "PASS"
    ? copy.tradeJournals.strategyCodeStatuses.pass
    : status === "FAIL"
      ? copy.tradeJournals.strategyCodeStatuses.fail
      : copy.tradeJournals.strategyCodeStatuses.unrated;

  return (
    <Badge
      className={cn(
        "shrink-0 px-1.5 py-0",
        status === "PASS" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        status === "FAIL" && "border-red-200 bg-red-50 text-red-700",
        status === "UNRATED" && "border-slate-200 bg-slate-100 text-slate-600",
      )}
    >
      {label}
    </Badge>
  );
}

function ScreenshotInput({ value, onChange }: { value: File | null; onChange: (value: File | null) => void }) {
  const [pasteError, setPasteError] = useState<string | null>(null);

  function chooseScreenshot(file: File | null) {
    if (!file) {
      onChange(null);
      setPasteError(null);
      return;
    }
    if (!acceptedScreenshotTypes.has(file.type)) {
      setPasteError(copy.tradeJournals.screenshotPasteUnsupported);
      return;
    }
    onChange(file);
    setPasteError(null);
  }

  function pasteScreenshot(clipboardData: DataTransfer) {
    const imageItem = Array.from(clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (!imageItem) return false;
    chooseScreenshot(imageItem.getAsFile());
    return true;
  }

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (event.clipboardData && pasteScreenshot(event.clipboardData)) event.preventDefault();
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  return (
    <div
      className="w-64 space-y-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      aria-label={copy.tradeJournals.screenshotPasteHint}
      onPaste={(event) => {
        if (!pasteScreenshot(event.clipboardData)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="h-8 w-full text-xs"
        onChange={(event) => chooseScreenshot(event.target.files?.[0] ?? null)}
      />
      <p className="text-xs text-slate-500">
        {value
          ? copy.tradeJournals.screenshotSelected.replace("{name}", value.name || copy.tradeJournals.pastedScreenshot)
          : copy.tradeJournals.screenshotPasteHint}
      </p>
      {pasteError ? <p className="text-xs text-red-600">{pasteError}</p> : null}
    </div>
  );
}

function OptionSelect({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: TradeOption[]; placeholder: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} disabled={!option.active && option.id !== value}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <TableCell><Input type="number" min="0.00000001" step="any" value={value} onChange={(event) => onChange(event.target.value)} className="w-28 text-right" /></TableCell>;
}

function PriceCell({ value }: { value: number | null }) {
  return <TableCell className="text-right font-mono">{value === null ? copy.common.dash : formatNumber(value)}</TableCell>;
}

function FilteredStat({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function buildTradeOptionFilters(rows: JournalTradeRow[], type: "instrument" | "strategy") {
  const optionMap = new Map<string, string>();

  rows.forEach((row) => {
    const id = type === "instrument" ? row.instrumentOptionId : row.strategyOptionId;
    const name = type === "instrument" ? row.instrumentOption?.name : row.strategyOption?.name;
    if (id && name) optionMap.set(id, name);
  });

  return Array.from(optionMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function buildTradeTagFilters(rows: JournalTradeRow[]) {
  const tagsById = new Map<string, string>();
  rows.forEach((row) => row.tags.forEach((tag) => tagsById.set(tag.id, tag.name)));
  return Array.from(tagsById, ([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function areFiltersEmpty(filters: Filters) {
  return filters.instrumentOptionId === allFilterValue
    && filters.strategyOptionIds.length === 0
    && filters.tagIds.length === 0
    && filters.direction === "ALL"
    && filters.dateFrom === ""
    && filters.dateTo === ""
    && filters.strategyCodeRegex.trim() === ""
    && !isRFilterActive(filters);
}

function isRFilterActive(filters: Filters) {
  return filters.rExpression.trim() !== "";
}

function matchesFilters(
  trade: JournalTradeRow,
  filters: Filters,
  strategyCodeFilter: StrategyCodeRegexFilter,
) {
  if (filters.instrumentOptionId !== allFilterValue && trade.instrumentOptionId !== filters.instrumentOptionId) return false;
  if (filters.strategyOptionIds.length > 0 && (!trade.strategyOptionId || !filters.strategyOptionIds.includes(trade.strategyOptionId))) return false;
  if (!matchesAnyTag(trade.tags, filters.tagIds)) return false;
  if (!strategyCodeFilter.test(trade.strategyCode)) return false;
  if (filters.direction !== "ALL" && trade.direction !== filters.direction) return false;
  if (filters.dateFrom && (!trade.date || trade.date < filters.dateFrom)) return false;
  if (filters.dateTo && (!trade.date || trade.date > filters.dateTo)) return false;

  return matchesRFilter(trade.rMultiple, filters);
}

function matchesRFilter(rMultiple: number, filters: Filters) {
  return compileRExpressionFilter(filters.rExpression).test(rMultiple);
}

function getVisibleRows(rows: JournalTradeRow[], filters: Filters) {
  const strategyCodeFilter = compileStrategyCodeRegex(filters.strategyCodeRegex);
  return rows.filter((trade) => matchesFilters(trade, filters, strategyCodeFilter));
}

function getSortedRows(rows: JournalTradeRow[], sort: SortState) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const result = sort.key === "date"
        ? a.row.date.localeCompare(b.row.date)
        : a.row.rMultiple - b.row.rMultiple;

      return result === 0 ? a.index - b.index : result * direction;
    })
    .map(({ row }) => row);
}

function serializeApiTrade(trade: JournalTradeRow & { date: string }) {
  return { ...trade, date: trade.date.slice(0, 10) };
}
