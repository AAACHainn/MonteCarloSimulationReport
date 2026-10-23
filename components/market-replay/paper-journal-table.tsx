"use client";
import { usePaperJournalTableController } from "./use-paper-journal-table-controller";






import { ChevronLeft, ChevronRight, Download, Loader2, Pencil, RotateCcw, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { ExpressionFilterPopover } from "@/components/ui/expression-filter-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { MultiOptionFilterPopover } from "@/components/ui/multi-option-filter-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PdfExportButton } from "@/components/market-replay/pdf-export-button";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { ReviewEditorDialog } from "@/components/market-replay/review-editor-dialog";
import { limitReview } from "@/lib/paper-trading/review-templates";
import { formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { replayJournalTradeHref } from "@/lib/paper-trading/journal-links";
import { formatInterval } from "@/lib/market-replay/types";
import { utcDateParts } from "@/lib/market-replay/display-timezone";
import { MAX_JOURNAL_COLUMN_WIDTH, MIN_JOURNAL_COLUMN_WIDTH } from "@/lib/market-replay/journal-column-widths";

import { journalColumns, journalFieldValue } from "@/lib/paper-trading/journal-columns";
import { journalSetupChecklist, journalSetupChecklistTitle } from "@/lib/paper-trading/journal-checklist";

import type { ReplayJournalEntryData } from "@/lib/paper-trading/types";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";









const defaultVisibleColumnIds = journalColumns.map((column) => column.id);







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
  replaySessions,
}: {
  datasetId: string;
  scope: "current" | "history";
  onFocus?: (entry: ReplayJournalEntryData) => void;
  replaySessions?: Pick<ReplaySessionSummary, "id" | "name" | "mode" | "status" | "createdAt">[];
}) {
  const {
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
  } = usePaperJournalTableController({ datasetId, scope });

  const sessionPicker = scope === "history" && replaySession && replaySessions ? <div className="w-full space-y-2 sm:max-w-xl" aria-busy={switchingSession}>
    <Label htmlFor="replay-journal-session">{copy.paperTrading.journalSessionSelect}</Label>
    <Select
      value={replaySession.id}
      onValueChange={(id) => {
        if (id === replaySession.id) return;
        startSessionNavigation(() => router.push(`/market-replay/${datasetId}/trade-history?sessionId=${encodeURIComponent(id)}`));
      }}
      disabled={loading || switchingSession || renaming || savingSetupIds.size > 0 || savingTradeReasonIds.size > 0 || savingReviewIds.size > 0}
    >
      <SelectTrigger id="replay-journal-session" className="w-full bg-white">
        <SelectValue placeholder={copy.paperTrading.journalSessionSelectPlaceholder} />
      </SelectTrigger>
      <SelectContent className="max-w-[min(40rem,calc(100vw-2rem))]">
        {replaySessions.map((session) => <SelectItem key={session.id} value={session.id}>
          {session.id === replaySession.id ? selectedSession?.name ?? session.name : session.name} · {session.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay} · {session.status === "ACTIVE" ? copy.replaySessions.active : copy.replaySessions.archived} · {new Date(session.createdAt).toLocaleString("zh-CN")}
        </SelectItem>)}
      </SelectContent>
    </Select>
    {switchingSession ? <p className="flex items-center gap-2 text-xs text-slate-500" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{copy.paperTrading.journalSessionSwitching}</p> : null}
  </div> : null;

  if (loading && items.length === 0 && sessions.length === 0) return <div className="space-y-4">{sessionPicker}<div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{copy.paperTrading.journalLoading}</div></div>;
  if (error && items.length === 0 && sessions.length === 0) return <div className="space-y-4">{sessionPicker}<p className="py-6 text-sm text-red-600" role="alert">{error}</p></div>;
  if (items.length === 0 && sessions.length === 0) return <div className="space-y-4">{sessionPicker}<p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">{copy.paperTrading.noJournalEntries}</p></div>;
  return <div className="space-y-4" aria-busy={loading || switchingSession}>
    {scope === "history" && selectedSession ? <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {sessionPicker}
        <div className="flex flex-wrap items-center gap-2">
          {ai && replaySession ? <Button variant="outline" size="sm" disabled={loading} onClick={() => void ai.attach({
            replaySessionId: replaySession.id, projectionId: replaySession.activeProjectionId, depth: "quick", images: false,
          }).catch(() => undefined)}>{copy.ai.summarize}</Button> : null}
          <Button asChild variant="outline" size="sm">
            <a href={scopedUrl(`/api/market-datasets/${datasetId}/paper-journal/sessions/${selectedSession.id}/export`)} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              {copy.paperTrading.exportJournalExcel}
            </a>
          </Button>
          <PdfExportButton datasetId={datasetId} sessionId={selectedSession.id} filters={appliedFilters} loading={loading} count={totalItems} />
          <Button type="button" variant="outline" size="sm" onClick={openVisibleColumns}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            {copy.paperTrading.setVisibleColumns}
          </Button>
          {!replaySession || replaySession.status === "ACTIVE" ? <Button type="button" variant="outline" size="sm" onClick={beginRename} disabled={loading}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {copy.paperTrading.renameJournalSession}
          </Button> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-800">{selectedSession.name}</span>
        <span className="tabular-nums">{new Date(selectedSession.createdAt).toLocaleString("zh-CN")}</span>
        <span>{selectedSession.entryCount} {copy.paperTrading.journalRows}</span>
        <span>{selectedSession.archivedAt ? copy.paperTrading.journalArchived : copy.paperTrading.journalCurrent}</span>
        {replaySession ? <><span>{replaySession.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay}</span><span>{copy.replaySessions.source}</span></> : null}
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
        style={{ width: visibleTableWidth, minWidth: visibleTableWidth, marginLeft: visibleTableLeftOffset }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={copy.paperTrading.resizeJournalTableStart}
          aria-valuemin={Math.max(baseTableWidth, tableViewportWidth)}
          aria-valuemax={visibleTableWidth + visibleTableLeftOffset - tableMinimumLeftOffset}
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
            {canDeleteCycle ? <col style={{ width: correctionColumnWidth }} /> : null}
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
            {canDeleteCycle ? <th className="border-b px-3 py-2 text-right">{copy.replaySessions.correction}</th> : null}
          </tr></thead>
          <tbody>{items.length === 0 && scope === "history" ? <tr>
            <td colSpan={visibleColumns.length + Number(canDeleteCycle)} className="px-4 py-8 text-center text-sm text-slate-500">
              {hasActiveFilters ? copy.paperTrading.noFilteredJournalEntries : copy.paperTrading.noJournalEntries}
            </td>
          </tr> : items.map((entry) => {
            const checklist = journalSetupChecklist(entry, setupOptions);
            return <tr key={entry.id} className="border-b last:border-b-0 hover:bg-slate-50">
            {visibleColumnSet.has("no") ? <td className="border-r px-3 py-2 last:border-r-0">{onFocus ? <button
              type="button"
              className="cursor-pointer font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() => onFocus(entry)}
            >{entry.no}</button> : <Link
              href={replayJournalTradeHref(datasetId, entry.journalSessionId, entry.globalNo)}
              className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-label={copy.paperTrading.openHistoricalReplay(entry.no)}
            >{entry.no}</Link>}</td> : null}
            {visibleColumnSet.has("date") ? <td className="border-r px-3 py-2 last:border-r-0">{date(entry)}</td> : null}
            {visibleColumnSet.has("direction") ? <td className="border-r px-3 py-2 last:border-r-0">{entry.direction === "LONG" ? copy.paperTrading.long : copy.paperTrading.short}</td> : null}
            {visibleColumnSet.has("setup") ? <td className="border-r p-1 text-left last:border-r-0">
              <div className="min-w-0 max-w-full">
                <SearchableSelect
                  value={entry.setupOptionId ?? noSetupValue}
                  onValueChange={(value) => void updateSetup(entry, value)}
                  disabled={setupOptionsLoading || savingSetupIds.has(entry.id)}
                  busy={savingSetupIds.has(entry.id)}
                  placeholder={copy.paperTrading.chooseSetup}
                  selectedLabel={entry.setupOption?.name ?? copy.paperTrading.chooseSetup}
                  selectedTooltip={checklist ? journalSetupChecklistTitle(checklist) : undefined}
                  searchPlaceholder={copy.paperTrading.searchSetup}
                  ariaLabel={copy.paperTrading.editSetup(entry.no)}
                  className="h-8 min-w-0 max-w-full overflow-hidden border-transparent bg-transparent px-2 text-left shadow-none hover:border-slate-300 hover:bg-white data-[state=open]:border-blue-300 data-[state=open]:bg-white"
                  options={[
                    { value: noSetupValue, label: copy.paperTrading.clearSetup },
                    ...setupOptions.filter((option) => option.active).map((option) => ({
                      value: option.id, label: option.name,
                    })),
                  ]}
                />
                {entry.discipline ? <Button variant="ghost" size="sm" className="h-8 max-w-full" onClick={() => setDisciplineEntry(entry)}>{entry.discipline.mode === "PLAN" ? copy.trainingGate.planSnapshot : copy.trainingGate.snapshot}</Button> : null}
              </div>
            </td> : null}
            {visibleColumnSet.has("checklistUsed") ? <td className="border-r px-3 py-2 text-left last:border-r-0">{journalFieldValue(entry, "checklistUsed")}</td> : null}
            {visibleColumnSet.has("reason") ? <td className="border-r p-1 text-left last:border-r-0">
              <MultiSelect
                value={entry.tradeReasons.map((reason) => reason.id)}
                options={tradeReasonOptions.map((reason) => ({ value: reason.id, label: reason.name }))}
                onCommit={(values) => updateTradeReasons(entry, values)}
                placeholder={copy.paperTrading.chooseTradeReason}
                searchable
                searchPlaceholder={copy.paperTrading.searchTradeReason}
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
            {canDeleteCycle ? <td className="px-3 py-2 text-right"><Button type="button" variant="destructive" size="icon" disabled={loading || correction?.pending || !entry.cycleKey} aria-label={copy.replaySessions.deleteCycle} title={copy.replaySessions.deleteCycle} onClick={() => correction?.onDeleteCycle(entry)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></td> : null}
          </tr>;
          })}</tbody>
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
            <CheckboxField key={column.id} checked={draftVisibleColumnIds.includes(column.id)} onChange={() => toggleDraftColumn(column.id)}>
              {column.label}
            </CheckboxField>
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
    <Dialog open={Boolean(disciplineEntry)} title={disciplineEntry?.discipline?.mode === "PLAN" ? copy.trainingGate.planSnapshot : copy.trainingGate.snapshot} onClose={() => setDisciplineEntry(null)}>
      {disciplineEntry?.discipline ? disciplineEntry.discipline.mode === "PLAN"
        ? <div className="space-y-3 text-sm"><p className="font-medium">{copy.trainingGate.marketContexts[disciplineEntry.discipline.context]}</p><p className="whitespace-pre-wrap break-words">{disciplineEntry.discipline.plan}</p><p className="text-xs text-slate-500">{copy.trainingGate.planSequence(disciplineEntry.discipline.confirmedSequence)} · {formatInterval(disciplineEntry.discipline.displayIntervalSeconds)} · {new Date(disciplineEntry.discipline.confirmedAt).toLocaleString("zh-CN")}</p></div>
        : <div className="space-y-4"><p className="text-sm font-medium">{disciplineEntry.discipline.strategyName}</p><p className="text-xs text-slate-500">{copy.trainingGate.confirmedAt} · {new Date(disciplineEntry.discipline.confirmedAt).toLocaleString("zh-CN")}</p>{disciplineEntry.discipline.checklist.map((item) => <CheckboxField key={item.id} checked disabled onChange={() => undefined}>{item.text}</CheckboxField>)}</div> : null}
    </Dialog>
    <ReviewEditorDialog
      open={reviewDialogEntryId !== null}
      no={items.find((entry) => entry.id === reviewDialogEntryId)?.no ?? 0}
      value={reviewDialogDraft}
      initialValue={reviewDialogInitialValue}
      onChange={setReviewDialogDraft}
      onSave={() => void saveReviewDialog()}
      onClose={() => setReviewDialogEntryId(null)}
      saving={reviewDialogEntryId ? savingReviewIds.has(reviewDialogEntryId) : false}
      error={reviewError}
      aiOpen={ai?.open}
      aiScope={replaySession && reviewDialogEntryId ? { replaySessionId: replaySession.id, projectionId: replaySession.activeProjectionId, sessionName: replaySession.name, entryId: reviewDialogEntryId } : undefined}
      onAi={ai && replaySession ? (templateId) => {
        if (!reviewDialogEntryId) return;
        void ai.attach({ replaySessionId: replaySession.id, projectionId: replaySession.activeProjectionId,
          entryId: reviewDialogEntryId, templateId, draft: reviewDialogDraft, depth: "quick", images: true,
        }).catch(() => undefined);
      } : undefined}
    />
    <RenameDialog
      open={renameOpen}
      title={copy.paperTrading.renameJournalSessionTitle}
      description={copy.paperTrading.renameJournalSessionDescription}
      label={copy.paperTrading.journalSessionName}
      value={renameDraft} onChange={setRenameDraft} maxLength={80}
      placeholder={copy.paperTrading.journalSessionNamePlaceholder}
      error={renameError} isLoading={renaming}
      confirmLabel={copy.paperTrading.saveJournalSessionName}
      onCancel={() => setRenameOpen(false)} onConfirm={() => void renameSession()}
    />
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
