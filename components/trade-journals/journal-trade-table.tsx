"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ScreenshotPreviewDialog } from "@/components/trade-journals/screenshot-preview-dialog";
import { JournalTradeBrowser } from "@/components/trade-journals/journal-trade-browser";
import { SqnStatLabel } from "@/components/trade-journals/sqn-stat-label";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ColumnFilterPopover } from "@/components/ui/column-filter-popover";
import { ExpressionFilterPopover } from "@/components/ui/expression-filter-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { calculateJournalStats } from "@/lib/trade-journal/calculations";
import { getTradeScreenshotUrl } from "@/lib/trade-journal/screenshot-url";
import {
  evaluateStrategyCode,
  validateStrategyCode,
} from "@/lib/trade-journal/strategy-code";
import { type TradeTagValue } from "@/lib/trade-journal/tags";
import { cn } from "@/lib/utils";

import { TradeOption, JournalTradeRow, Draft, SortKey, SortState, DirectionFilter, Filters, emptyDraft, pageSizeOptions, allFilterValue, defaultSortDirections, emptyFilters, buildTradeOptionFilters, buildTradeTagFilters, areFiltersEmpty, getVisibleRows, getSortedRows, serializeApiTrade } from "./journal-trade-table-model";
import { FilterableHead, OptionFilterPanel, MultiOptionFilterPanel, DateFilterPanel, StrategyCodeRegexFilterPanel, SortableHead, EditableRow, StrategyCodeBadge, PriceCell, FilteredStat } from "./journal-trade-table-controls";
export type { TradeOption, JournalTradeRow } from "./journal-trade-table-model";

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
                <ExpressionFilterPopover
                  id="r"
                  openFilter={openFilter}
                  setOpenFilter={setOpenFilter}
                  label={copy.tradeJournals.filters.rMode}
                  disabled={editingId !== null}
                  conditionLabel={copy.tradeJournals.filters.rMode}
                  expression={filters.rExpression}
                  onExpressionChange={(value) => setFilter("rExpression", value)}
                  onClear={() => setFilter("rExpression", "")}
                />
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
