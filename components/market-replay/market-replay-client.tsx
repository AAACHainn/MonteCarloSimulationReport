"use client";

import { dateTimeLocalValue } from "@/lib/market-replay/start-time";
import { ReplayDateDialog } from "./replay-date-dialog";
import { ReplaySessionSwitch } from "./replay-session-switch";
import { ReplayCorrectionProvider } from "./replay-correction-context";
import { ReplayCorrectionDialog } from "./replay-correction-dialog";
import Link from "next/link";
import { TrainingGateConfigDialog, EntryCheckDialog } from "./training-gate-dialogs";
import { type ReactNode } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Square, BookOpen, ListTree, Loader2, Palette, RotateCcw, Ruler, Settings2, Trash2, TrendingUp, WalletCards, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { ReplayChart } from "@/components/market-replay/replay-chart";
import { ReplayAutoPauseNotice } from "@/components/market-replay/replay-auto-pause-notice";
import { IndicatorSettingsDialog } from "@/components/market-replay/indicator-settings-dialog";
import { DisplayIntervalControls } from "@/components/market-replay/display-interval-controls";
import { ReplayStartDialog } from "@/components/market-replay/replay-start-dialog";
import { ChartVisibilityMenu } from "@/components/market-replay/chart-visibility-menu";
import { PaperAccountStrip, PaperTradingPanel } from "@/components/market-replay/paper-trading-panel";
import { ReplayPlaybackBar } from "@/components/market-replay/replay-playback-bar";
import { RectangleSettingsDialog, RectangleToolOption } from "./rectangle-controls";
import { LineSettingsDialog } from "./line-settings-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { Type as TextIcon } from "lucide-react";
import { TextSettingsDialog, TextToolOption } from "./text-settings-dialog";
import { runDrawingWrite } from "@/lib/market-replay/drawing-write-queue";
import { deleteTextDrawing, persistTextDrawing } from "@/lib/market-replay/text-persistence";
import { drawingObjectName, drawingObjectColor, drawingSettingsLabel, drawingDeleteLabel } from "@/lib/market-replay/drawing-presentation";
import { UTC_OFFSET_OPTIONS, formatUtcOffset } from "@/lib/market-replay/display-timezone";
import { type DisplaySession } from "@/lib/market-replay/types";
import { DRAWING_TYPE_FIB_RETRACEMENT, DRAWING_TYPE_TREND_LINE, DRAWING_TYPE_RECTANGLE, DRAWING_TYPE_TEXT, type FibonacciRetracementStyle, type TrendLineStyle } from "@/lib/market-replay/chart-drawings";
import { cloneFibonacciStyle, formatDatasetTime } from "./replay-client-shared";
import type { JournalFocus } from "./replay-client-shared";
import type { MarketDatasetSummary } from "@/lib/market-replay/types";
import { useReplayCore } from "./use-replay-core";
import { useReplayDrawingWindow } from "./use-replay-drawing-window";
import { useReplayEngine } from "./use-replay-engine";
import { useReplayActions } from "./use-replay-actions";

export function MarketReplayClient({ dataset: initialDataset, initialJournalFocus = null }: { dataset: MarketDatasetSummary; initialJournalFocus?: JournalFocus | null }) {
  const core = useReplayCore({ dataset: initialDataset, initialJournalFocus });
  const drawingWindow = useReplayDrawingWindow(core);
  const engine = useReplayEngine(core, drawingWindow);
  const actions = useReplayActions(core, drawingWindow, engine);
  const {
    fetch, replaySession, dateDialogOpen, setDateDialogOpen, dateDialogOpening, dateDialogMinimum,
    dateForwarding, forwardProgress, cancelForwardRef, correctionTarget, setCorrectionTarget, correctionPending,
    setCorrectionPending, dataset, retrying, shortcuts, webFullscreen, setWebFullscreen,
    bars, chartDataRevision, warmupBars, currentSourceBar, isLoading, loadError,
    setLoadError, replay, autoPauseEvent, restorePlayback, dismissAutoPause, wantsPlayback,
    startPickerRef, startValue, setStartValue, startDialogOpen, startDialogValue, setStartDialogValue,
    startDialogBusy, confirmationSuspensionRef, startError, confirmAction, setConfirmAction, settingsDialog,
    setSettingsDialog, candlestickStyleDraft, setCandlestickStyleDraft, emaError, abrError, barCountError,
    repairInterval, setRepairInterval, paperSnapshot, tradeAnnotations, tradeAnnotationsTruncated, paperBusy,
    paperError, journalReview, chartFocusSequence, setChartFocusSequence, reviewReturning, draftActive,
    setDraftActive, gateDialogOpen, setGateDialogOpen, gateBusy, gateError, checkingOrder,
    entryCheckDraft, setEntryCheckDraft, measurementArmed, setMeasurementArmed, drawingToolOpen, setDrawingToolOpen,
    drawingTool, setDrawingTool, drawings, setDrawings, clearingDrawings, drawingError,
    selectedDrawingId, setSelectedDrawingId, drawingObjectsOpen, setDrawingObjectsOpen, rectangleStyleId, setRectangleStyleId,
    styleDrawingId, setStyleDrawingId, styleDraft, setStyleDraft, pendingDrawingIds, candlestickStyle,
    setCandlestickStyle, emaEnabled, setEmaEnabled, emaIndicators, setEmaIndicators, abrEnabled,
    setAbrEnabled, abrLength, gridVisible, setGridVisible, volumeVisible, setVolumeVisible,
    candleCountdownEnabled, setCandleCountdownEnabled, barCountConfig, setBarCountConfig, chartVisibility, defaultRectangleStyle,
    setDefaultRectangleStyle, rectangleTemplates, setRectangleTemplates, setDefaultTextStyle, textTemplates, setTextTemplates,
    defaultTrendLineStyle, setDefaultTrendLineStyle, trendLineTemplates, setTrendLineTemplates, defaultFibonacciStyle, setDefaultFibonacciStyle,
    fibonacciTemplates, setFibonacciTemplates, displayUtcOffsetMinutes, setDisplayUtcOffsetMinutes, textDrawing, drawingWriteScope,
    drawingsLive, visibleBarCountConfig, displayMarketSession,
  } = core;
  const {
    armDrawing, changeChartVisibility, armTrendLine, armFibonacciRetracement, createDrawing, updateDrawing,
    deleteDrawing, clearDrawings, openDrawingStyle, visibleDrawings, handleVisibleSequenceRange,
  } = drawingWindow;
  const {
    beginReplay, returnToLiveWindow, togglePlayback, revealNextBar, enterJournalReview,
  } = engine;
  const {
    changeSpeed, changeDisplayInterval, changeChartSession, setEmaLength, updateAbrLength, updateBarCountInterval,
    updateBarCountRecentTradingDays, addEma, requestConfirmation, openStartDialog, closeStartDialog, applyNewReplayStart,
    applyConfirmedAction, openCorrectionTarget, openDateDialog, locateReplayDate, prepareSessionSwitch, createPaperAccount,
    onChartDraftChange, submitPaperOrder, cancelEntryCheck, confirmEntryCheck, saveGateConfig, currentGate,
    gateButton, gateNoticeBlock, updatePaperOrder, cancelPaperOrder, cancelPaperScope, closePaperPosition,
    currentBar, revealedCount, replayCount, statusText,
  } = actions;
  function wrapWorkspace(content: ReactNode) {
    return <div className="flex h-full min-h-0 flex-col gap-2">
      {!webFullscreen ? <header className="shrink-0" data-replay-workspace-header>
        <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name }]} />
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <h1 className="shrink-0 text-xl font-semibold tracking-tight text-slate-950">{copy.marketReplay.replayTitle(dataset.symbol, dataset.timeframe)}</h1>
          <p className="min-w-0 truncate text-xs text-slate-500">{dataset.name} · {dataset.timezone}</p>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{gateButton}<ReplaySessionSwitch beforeSwitch={prepareSessionSwitch} disabled={isLoading || Boolean(loadError) || !replay || Boolean(checkingOrder)} /></div>
        </div>
      </header> : null}
      {!webFullscreen ? gateNoticeBlock : null}
      {gateDialogOpen ? <TrainingGateConfigDialog gate={currentGate} busy={gateBusy} error={gateError} onClose={() => setGateDialogOpen(false)} onSave={saveGateConfig} /> : null}
      {checkingOrder ? <EntryCheckDialog order={checkingOrder.order} approval={entryCheckDraft?.draftId === checkingOrder.draftId ? entryCheckDraft.approval : null} onApprovalChange={(approval) => setEntryCheckDraft((current) => current?.draftId === checkingOrder.draftId ? { ...current, approval } : current)} busy={paperBusy} error={paperError} onClose={cancelEntryCheck} onConfirm={confirmEntryCheck} /> : null}
      {content}
    </div>;
  }

  if (!dataset.sourceIntervalSeconds) return wrapWorkspace(
    <Card className="max-w-xl"><CardHeader><CardTitle>{copy.marketReplay.repairMetadata}</CardTitle><CardDescription>{copy.marketReplay.repairMetadataDescription}</CardDescription></CardHeader>
      <CardContent className="space-y-3"><Label htmlFor="repair-source-interval">{copy.marketReplay.sourceInterval}</Label><Input id="repair-source-interval" type="number" min="1" max="86400" value={repairInterval} onChange={(event) => setRepairInterval(event.target.value)} />
        <Button type="button" onClick={async () => {
          const response = await fetch(`/api/market-datasets/${dataset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceIntervalSeconds: Number(repairInterval), sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: [1,2,3,4,5,6,7] }) });
          const data = await response.json().catch(() => null); if (!response.ok) setLoadError(data?.error ?? copy.marketReplay.loadError); else window.location.reload();
        }}>{copy.marketReplay.saveMetadata}</Button>{loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}</CardContent></Card>
  );

  if (isLoading) return wrapWorkspace(
    <div className="space-y-3" aria-busy="true" aria-label={copy.marketReplay.loading}>
      <div className="flex h-12 items-center justify-between rounded-lg border bg-white px-4">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />{copy.marketReplay.loading}</div>
      </div>
      <div className="h-[min(68vh,44rem)] animate-pulse rounded-lg border bg-slate-100" />
      <div className="h-14 animate-pulse rounded-lg border bg-slate-50" />
    </div>
  );
  if (loadError) return wrapWorkspace(<Alert className="border-red-200 bg-red-50"><AlertTitle>{copy.marketReplay.loadError}</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>);

  if (!replay) {
    return wrapWorkspace(
      <Card className="max-w-xl">
        <CardHeader>
          <p className="font-mono text-xs uppercase tracking-wide text-blue-700">{copy.marketReplay.setupEyebrow}</p>
          <CardTitle>{copy.marketReplay.setupTitle}</CardTitle>
          <CardDescription>{copy.marketReplay.setupDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={beginReplay} className="space-y-4">
            <div className="space-y-2">
              <DateTimePicker ref={startPickerRef}
                minimum={dateTimeLocalValue(dataset.startTime, dataset.timezone)}
                maximum={dateTimeLocalValue(dataset.endTime, dataset.timezone)}
                value={startValue} onChange={setStartValue} />
              <p className="text-xs text-slate-500">{dataset.timezone} · {formatDatasetTime(dataset.startTime, dataset.timezone)} – {formatDatasetTime(dataset.endTime, dataset.timezone)}</p>
            </div>
            {startError ? <p className="text-sm text-red-600">{startError}</p> : null}
            <Button type="submit"><Settings2 className="h-4 w-4" />{copy.marketReplay.begin}</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <ReplayCorrectionProvider pending={correctionPending} onDeleteCycle={(entry) => { if (entry.cycleKey) openCorrectionTarget({ type: "DELETE_CYCLE", cycleKey: entry.cycleKey, no: entry.no }); }}>
    {wrapWorkspace(<>
      <div
        data-web-fullscreen={webFullscreen}
        aria-label={dataset.name}
        className={webFullscreen
          ? "fixed inset-0 z-40 flex h-dvh min-h-0 flex-col overflow-hidden bg-white"
          : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white shadow-sm"}
      >
        {webFullscreen ? gateNoticeBlock : null}
        {replaySession?.mode === "LIVE_REPLAY" ? <ReplayCorrectionDialog target={correctionTarget} displayUtcOffsetMinutes={displayUtcOffsetMinutes} beforeCreate={prepareSessionSwitch} onClose={() => setCorrectionTarget(null)} onPendingChange={setCorrectionPending} /> : null}
        <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 [&>*]:shrink-0">
          {webFullscreen ? gateButton : null}
          <DisplayIntervalControls
            value={replay.displayIntervalSeconds}
            sourceIntervalSeconds={dataset.sourceIntervalSeconds}
            disabled={Boolean(journalReview) || correctionPending}
            onChange={changeDisplayInterval}
          />
          {dataset.availableDisplaySessions.length > 1 ? (
            <>
              <Label htmlFor="display-session" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displaySession}</Label>
              <Select disabled={Boolean(journalReview) || correctionPending} value={replay.displaySession} onValueChange={(value) => void changeChartSession(value as DisplaySession)}>
                <SelectTrigger id="display-session" className="h-8 w-20" title={copy.marketReplay.displaySessionHint}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETH">{copy.marketReplay.displaySessionEth}</SelectItem>
                  <SelectItem value="RTH">{copy.marketReplay.displaySessionRth}</SelectItem>
                </SelectContent>
              </Select>
            </>
          ) : null}
          <Label htmlFor="display-timezone" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displayTimezone}</Label>
          <Select value={String(displayUtcOffsetMinutes)} onValueChange={(value) => setDisplayUtcOffsetMinutes(Number(value))}>
            <SelectTrigger id="display-timezone" className="h-8 w-28" title={copy.marketReplay.displayTimezoneHint}><SelectValue /></SelectTrigger>
            <SelectContent
              position="popper"
              sideOffset={4}
              align="end"
              collisionPadding={8}
              className="max-h-72 w-40"
            >
              {UTC_OFFSET_OPTIONS.map((offset) => <SelectItem key={offset} value={String(offset)}>{formatUtcOffset(offset)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <Popover.Root open={drawingToolOpen} onOpenChange={setDrawingToolOpen}>
            <Popover.Trigger asChild>
              <Button
                type="button"
                variant={drawingTool ? "secondary" : "ghost"}
                size="sm"
                className="h-8"
                aria-pressed={Boolean(drawingTool)}
                aria-label={copy.marketReplay.drawingToolsHint}
              >
                <TrendingUp className="h-4 w-4" />
                <span className="hidden xl:inline">{copy.marketReplay.drawingTools}</span>
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="start"
                sideOffset={6}
                collisionPadding={8}
                className="z-[80] w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  onClick={armTrendLine}
                  aria-keyshortcuts="Alt+t"
                >
                  <TrendingUp className="h-4 w-4 text-slate-600" />
                  <span className="font-medium">{copy.marketReplay.trendLine}</span>
                  <kbd className="ml-auto whitespace-nowrap font-mono text-[11px] text-slate-400">{shortcuts.trendLine}</kbd>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  onClick={armFibonacciRetracement}
                  aria-keyshortcuts="Alt+f"
                >
                  <span className="flex h-4 w-4 items-center justify-center font-mono text-[10px] font-bold text-slate-600">Fib</span>
                  <span className="font-medium">{copy.marketReplay.fibonacciRetracement}</span>
                  <kbd className="ml-auto whitespace-nowrap font-mono text-[11px] text-slate-400">{shortcuts.fibonacciRetracement}</kbd>
                </button>
                <RectangleToolOption shortcut={shortcuts.rectangle} onArm={() => armDrawing(DRAWING_TYPE_RECTANGLE)} />
              <TextToolOption onArm={() => armDrawing(DRAWING_TYPE_TEXT)} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button
            type="button"
            variant={drawingObjectsOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-8"
            aria-pressed={drawingObjectsOpen}
            title={`${copy.marketReplay.drawingObjectsHint}\n${copy.marketReplay.drawingDeleteShortcutHint(shortcuts.deleteDrawing)}`}
            onClick={() => setDrawingObjectsOpen((current) => !current)}
          >
            <ListTree className="h-4 w-4" />
            <span className="hidden xl:inline">{copy.marketReplay.drawingObjects}</span>
          </Button>
          <Button
            type="button"
            variant={measurementArmed ? "secondary" : "ghost"}
            size="sm"
            className="group relative h-8"
            aria-pressed={measurementArmed}
            aria-label={copy.marketReplay.measureHint}
            onClick={() => setMeasurementArmed((current) => !current)}
          >
            <Ruler className="h-4 w-4" />
            <span className="hidden xl:inline">{copy.marketReplay.measure}</span>
            <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-normal text-white shadow-lg group-hover:block group-focus-visible:block">
              {copy.marketReplay.measureHint}
            </span>
          </Button>
          <ChartVisibilityMenu value={chartVisibility} onChange={changeChartVisibility} />
          <Button
            type="button"
            variant={settingsDialog === "candlesticks" ? "secondary" : "ghost"}
            size="sm"
            className="h-8"
            onClick={() => {
              setCandlestickStyleDraft({ ...candlestickStyle });
              setSettingsDialog("candlesticks");
            }}
          >
            <Palette className="h-4 w-4" />
            <span className="hidden xl:inline">{copy.marketReplay.candlestickStyle}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setSettingsDialog("indicators")}><Settings2 className="h-4 w-4" />{copy.marketReplay.indicators}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setSettingsDialog("paper")}><WalletCards className="h-4 w-4" />{copy.marketReplay.accountSettings}</Button>
          <Button asChild type="button" variant="ghost" size="sm" className="h-8"><Link href={`/market-replay/${dataset.id}/trade-history?sessionId=${encodeURIComponent(replaySession?.id ?? "")}`}><BookOpen className="h-4 w-4" />{copy.paperTrading.openJournalHistory}</Link></Button>
          {paperSnapshot ? <div className="hidden items-center gap-3 text-xs text-slate-500 xl:flex"><span>{copy.paperTrading.equity} <strong className="font-medium text-slate-800">{paperSnapshot.stats.equity.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} {paperSnapshot.session.currency}</strong></span><span>{copy.paperTrading.netPosition} <strong className="font-medium text-slate-800">{paperSnapshot.session.netQuantity}</strong></span></div> : null}
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={draftActive} title={draftActive ? copy.paperTrading.draftLockedReplay : undefined} onClick={() => requestConfirmation("reset")}><RotateCcw className="h-4 w-4" /><span className="hidden xl:inline">{copy.marketReplay.reset}</span></Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={draftActive} title={draftActive ? copy.paperTrading.draftLockedReplay : undefined} onClick={openStartDialog}><span className="hidden xl:inline">{copy.marketReplay.chooseNewStart}</span><span className="xl:hidden">{copy.marketReplay.startAt}</span></Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {autoPauseEvent ? (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[60]">
              <ReplayAutoPauseNotice event={autoPauseEvent} onDismiss={dismissAutoPause} />
            </div>
          ) : null}
          <ReplayChart
            datasetId={dataset.id}
            dataRevision={chartDataRevision}
            priceTickSize={dataset.priceTickSize}
            bars={bars}
            warmupBars={warmupBars}
            displayUtcOffsetMinutes={displayUtcOffsetMinutes}
            displayIntervalSeconds={replay.displayIntervalSeconds}
            sourceIntervalSeconds={dataset.sourceIntervalSeconds}
            candleCountdownEnabled={chartVisibility.indicators && candleCountdownEnabled}
            playbackActive={replay.status === "playing"}
            currentSourceTimestamp={currentBar?.timestamp ?? null}
            measurementArmed={measurementArmed}
            candlestickStyle={candlestickStyleDraft ?? candlestickStyle}
            onMeasurementArmedChange={setMeasurementArmed}
            drawingTool={drawingTool}
            onDrawingToolChange={setDrawingTool}
            onPlaceText={textDrawing.place} drawingApiRef={textDrawing.apiRef}
            trendLineDraftStyle={defaultTrendLineStyle}
            fibonacciDraftStyle={defaultFibonacciStyle}
            rectangleDraftStyle={defaultRectangleStyle}
            drawings={visibleDrawings}
            selectedDrawingId={selectedDrawingId}
            onSelectedDrawingIdChange={setSelectedDrawingId}
            onCreateDrawing={(type, geometry) => void createDrawing(type, geometry)}
            onUpdateDrawing={(id, geometry) => void updateDrawing(id, { geometry })}
            onDeleteDrawing={(id) => void deleteDrawing(id)}
            onOpenDrawingStyle={openDrawingStyle}
            emaEnabled={chartVisibility.indicators && emaEnabled}
            emaIndicators={emaIndicators}
            abrEnabled={chartVisibility.indicators && abrEnabled}
            abrLength={abrLength}
            volumeVisible={chartVisibility.indicators && volumeVisible}
            gridVisible={gridVisible}
            onToggleGrid={() => setGridVisible((current) => !current)}
            displaySession={replay.displaySession}
            barCountSession={displayMarketSession}
            barCountConfig={visibleBarCountConfig}
            paperSnapshot={journalReview ? null : paperSnapshot}
            tradeAnnotations={tradeAnnotations}
            tradeAnnotationsTruncated={tradeAnnotationsTruncated}
            tradeAnnotationsVisible={chartVisibility.tradeAnnotations}
            focusSequence={chartFocusSequence}
            onFocusApplied={() => setChartFocusSequence(null)}
            paperBusy={paperBusy || correctionPending || dateForwarding}
            paperError={paperError}
            onSubmitOrder={submitPaperOrder}
            onOrderPriceChange={updatePaperOrder}
            onCancelOrder={cancelPaperOrder}
            onClosePosition={closePaperPosition}
            onDraftActiveChange={setDraftActive}
            onDraftIdentityChange={onChartDraftChange}
            entryCheckOpen={Boolean(checkingOrder)}
            onOpenPaperAccount={() => setSettingsDialog("paper")}
            onVisibleSequenceRangeChange={handleVisibleSequenceRange}
            rewindRange={{ minSequence: replay.startSequence - 1, maxSequence: replay.currentSequence }}
            onRewindToBar={replaySession?.mode === "LIVE_REPLAY" && !replaySession.legacy && !journalReview
              ? (target) => openCorrectionTarget({ type: "REWIND", sequence: target.sequence, chartTimestamp: target.timestamp }) : undefined}
          />
          {journalReview ? <div className="absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-violet-200 bg-white/95 px-3 py-2 text-sm text-violet-800 shadow-lg backdrop-blur"><span className="font-medium">{journalReview.no > 0 ? copy.paperTrading.journalReviewing(journalReview.no) : copy.replaySessions.viewingPast}</span><Button type="button" variant="outline" size="sm" className="h-7" onClick={() => void returnToLiveWindow()}>{copy.paperTrading.returnToLive}</Button></div> : null}
          {drawingError ? (
            <div className="pointer-events-none absolute left-3 top-3 z-40 max-w-sm rounded-md border border-red-200 bg-red-50/95 px-3 py-2 text-xs text-red-700 shadow-sm">
              {drawingError}
            </div>
          ) : null}
          {drawingObjectsOpen ? (
            <aside className="absolute right-3 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
              <header className="flex items-center gap-2 border-b px-3 py-2.5">
                <ListTree className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">{copy.marketReplay.drawingObjects}</h3>
                <Button type="button" variant="ghost" size="sm" disabled={clearingDrawings || Boolean(pendingDrawingIds.size) || !drawings.length}
                  data-text-delete="all" aria-label={copy.marketReplay.clearDrawings} className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => void clearDrawings()}>{copy.marketReplay.clearDrawingsShort}</Button>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={copy.marketReplay.closeDrawingObjects}
                  onClick={() => setDrawingObjectsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {drawings.length ? drawings.map((drawing, index) => {
                  const pending = clearingDrawings || pendingDrawingIds.has(drawing.id);
                  const selected = selectedDrawingId === drawing.id;
                  const drawingColor = drawingObjectColor(drawing);
                  return (
                    <div
                      key={drawing.id}
                      role="button"
                      tabIndex={0}
                      className={`group flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-colors ${selected ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}
                      onClick={() => setSelectedDrawingId(drawing.id)}
                      onDoubleClick={() => openDrawingStyle(drawing.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedDrawingId(drawing.id);
                        }
                      }}
                    >
                      {drawing.type === DRAWING_TYPE_RECTANGLE ? <Square className="h-4 w-4 shrink-0" style={{ color: drawingColor }} aria-hidden="true" /> : drawing.type === DRAWING_TYPE_TREND_LINE
                        ? <TrendingUp className="h-4 w-4 shrink-0" style={{ color: drawingColor, opacity: drawing.style.opacity / 100 }} />
                        : drawing.type === DRAWING_TYPE_TEXT ? <TextIcon className="h-4 w-4 shrink-0" style={{ color: drawingColor }} aria-hidden="true" />
                        : <span className="flex h-4 w-4 shrink-0 items-center justify-center font-mono text-[9px] font-bold" style={{ color: drawingColor }}>Fib</span>}
                      <span className="min-w-0 flex-1 truncate font-medium">{drawingObjectName(drawing, index + 1)}</span>
                      {drawing.type === DRAWING_TYPE_RECTANGLE || drawing.type === DRAWING_TYPE_TEXT ? <Button type="button" variant="ghost" size="icon" disabled={pending}
                        data-text-settings={drawing.id} aria-label={drawingSettingsLabel(drawing)} onClick={event => { event.stopPropagation(); openDrawingStyle(drawing.id); }}>
                        <Settings2 className="h-4 w-4" aria-hidden="true" />
                      </Button> : null}
                      <button
                        type="button"
                        disabled={pending}
                        data-text-delete={drawing.id} aria-label={drawingDeleteLabel(drawing)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteDrawing(drawing.id);
                        }}
                      >
                        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  );
                }) : <p className="px-3 py-8 text-center text-xs text-slate-500">{copy.marketReplay.drawingObjectsEmpty}</p>}
              </div>
            </aside>
          ) : null}
        </div>
        <ReplayPlaybackBar
          onLocateDate={() => { void openDateDialog(); }}
          dateForwarding={dateForwarding}
          dateForwardStatus={forwardProgress ? copy.replaySessions.forwardProgress(forwardProgress.current, forwardProgress.target) : copy.replaySessions.forwarding}
          onStopDateForward={() => { cancelForwardRef.current = true; }}
          correctionPending={correctionPending || dateForwarding || dateDialogOpen || dateDialogOpening || reviewReturning || Boolean(checkingOrder)}
          replay={replay}
          sourceIntervalSeconds={dataset.sourceIntervalSeconds}
          paperSnapshot={paperSnapshot}
          currentBar={currentBar}
          displayUtcOffsetMinutes={displayUtcOffsetMinutes}
          revealedCount={revealedCount}
          replayCount={replayCount}
          statusText={statusText}
          retrying={retrying}
          playbackRequested={replay.status === "playing" || (retrying && wantsPlayback())}
          webFullscreen={webFullscreen}
          onToggleWebFullscreen={() => setWebFullscreen((current) => !current)}
          onToggle={togglePlayback}
          onNext={() => void revealNextBar()}
          onSpeedChange={changeSpeed}
          onFocusJournalEntry={(entry) => void enterJournalReview({ sequence: entry.openedSequence, no: entry.no, globalNo: entry.globalNo })}
        />
      </div>

      {textDrawing.editor ? <TextSettingsDialog key={textDrawing.editor.key} editor={textDrawing.editor}
        apiRef={textDrawing.apiRef}
        onAdopt={textDrawing.adopt} register={textDrawing.register} isCurrent={textDrawing.guard()}
        templates={textTemplates} onTemplatesChange={setTextTemplates} onPreview={textDrawing.preview} onClose={textDrawing.close}
        onRemove={(id, current) => runDrawingWrite(drawingWriteScope, async () => {
          if (!current()) throw new Error(copy.marketReplay.drawingDeleteError);
          await deleteTextDrawing(fetch, dataset.id, id);
          if (!current()) throw new Error(copy.marketReplay.drawingDeleteError);
          const next = drawingsLive.current.filter(item => item.id !== id);
          drawingsLive.current = next; setDrawings(next); setSelectedDrawingId(value => value === id ? null : value);
        })}
        onSave={(id, draft, clientId, current) => runDrawingWrite(drawingWriteScope, async () => {
          if (!current()) throw new Error(copy.marketReplay.textAutosaveError);
          const saved = await persistTextDrawing(fetch, dataset.id, id, draft, clientId);
          if (!current()) throw new Error(copy.marketReplay.textAutosaveError);
          const items = drawingsLive.current;
          const next = items.some(item => item.id === saved.id) ? items.map(item => item.id === saved.id ? saved : item) : [...items, saved];
          drawingsLive.current = next; setDrawings(next); setSelectedDrawingId(saved.id);
          setDefaultTextStyle({ ...saved.style }); return saved;
        })} /> : null}

      {(() => {
        const drawing = drawings.find(d => d.id === rectangleStyleId);
        return drawing?.type === DRAWING_TYPE_RECTANGLE ? <RectangleSettingsDialog key={drawing.id} drawing={drawing}
          templates={rectangleTemplates} onTemplatesChange={setRectangleTemplates} onClose={() => setRectangleStyleId(null)}
          onSave={async style => { const saved = await updateDrawing(drawing.id, { style }); if (saved) setDefaultRectangleStyle({ ...style }); return saved; }} /> : null;
      })()}
      <Dialog
        open={settingsDialog === "candlesticks"}
        title={copy.marketReplay.candlestickSettings}
        description={copy.marketReplay.candlestickSettingsDescription}
        className="max-w-md"
        onClose={() => {
          setCandlestickStyleDraft(null);
          setSettingsDialog(null);
        }}
      >
        {candlestickStyleDraft ? (
          <div className="space-y-5">
            <div className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 px-1 text-center text-xs font-medium text-slate-500">
              <span />
              <span>{copy.marketReplay.bullishCandle}</span>
              <span>{copy.marketReplay.bearishCandle}</span>
            </div>
            <div className="space-y-2">
              {([
                { visible: "bodyVisible", up: "upColor", down: "downColor", label: copy.marketReplay.candleBody },
                { visible: "borderVisible", up: "borderUpColor", down: "borderDownColor", label: copy.marketReplay.candleBorder },
                { visible: "wickVisible", up: "wickUpColor", down: "wickDownColor", label: copy.marketReplay.candleWick },
              ] as const).map((row) => (
                <div key={row.visible} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 rounded-md border px-3 py-2.5">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={candlestickStyleDraft[row.visible]}
                      onChange={(event) => setCandlestickStyleDraft((current) => current ? {
                        ...current,
                        [row.visible]: event.target.checked,
                      } : current)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {row.label}
                  </label>
                  <Input
                    type="color"
                    value={candlestickStyleDraft[row.up]}
                    aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bullishCandle)}
                    onChange={(event) => setCandlestickStyleDraft((current) => current ? {
                      ...current,
                      [row.up]: event.target.value.toUpperCase(),
                    } : current)}
                    className="mx-auto h-9 w-12 cursor-pointer p-1"
                  />
                  <Input
                    type="color"
                    value={candlestickStyleDraft[row.down]}
                    aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bearishCandle)}
                    onChange={(event) => setCandlestickStyleDraft((current) => current ? {
                      ...current,
                      [row.down]: event.target.value.toUpperCase(),
                    } : current)}
                    className="mx-auto h-9 w-12 cursor-pointer p-1"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setCandlestickStyleDraft(null);
                setSettingsDialog(null);
              }}>{copy.marketReplay.drawingCancel}</Button>
              <Button type="button" onClick={() => {
                setCandlestickStyle({ ...candlestickStyleDraft });
                setCandlestickStyleDraft(null);
                setSettingsDialog(null);
              }}>{copy.marketReplay.drawingConfirm}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <IndicatorSettingsDialog
        open={settingsDialog === "indicators"}
        onClose={() => setSettingsDialog(null)}
        candleCountdown={{
          enabled: candleCountdownEnabled,
          onChange: setCandleCountdownEnabled,
        }}
        volumeVisible={volumeVisible}
        onVolumeVisibleChange={setVolumeVisible}
        barCountConfig={barCountConfig}
        setBarCountConfig={setBarCountConfig}
        onBarCountRecentTradingDaysChange={updateBarCountRecentTradingDays}
        onBarCountIntervalChange={updateBarCountInterval}
        barCountError={barCountError}
        abrEnabled={abrEnabled}
        onAbrEnabledChange={setAbrEnabled}
        abrLength={abrLength}
        onAbrLengthChange={updateAbrLength}
        abrError={abrError}
        emaEnabled={emaEnabled}
        onEmaEnabledChange={setEmaEnabled}
        emaIndicators={emaIndicators}
        setEmaIndicators={setEmaIndicators}
        onEmaLengthChange={setEmaLength}
        onAddEma={addEma}
        emaError={emaError}
      />
      <Dialog open={settingsDialog === "paper" && !checkingOrder} keepMounted={settingsDialog === "paper"} title={copy.marketReplay.accountSettings} description={copy.marketReplay.accountSettingsDescription} className="max-w-3xl" onClose={() => setSettingsDialog(null)}>
        <div className="space-y-4">
          <PaperAccountStrip snapshot={paperSnapshot} />
          {journalReview ? null : <PaperTradingPanel priceTickSize={dataset.priceTickSize} snapshot={paperSnapshot} currentBar={currentBar} busy={paperBusy || correctionPending || dateForwarding} error={paperError} onCreate={createPaperAccount} onSubmit={submitPaperOrder} onCancel={cancelPaperOrder} onUpdate={updatePaperOrder} onCancelScope={cancelPaperScope} onClear={() => requestConfirmation("paper-clear")} />}
        </div>
      </Dialog>
      {(() => {
        const drawing = drawings.find(item => item.id === styleDrawingId);
        return drawing && drawing.type !== DRAWING_TYPE_RECTANGLE && drawing.type !== DRAWING_TYPE_TEXT && styleDraft ? <LineSettingsDialog key={drawing.id}
          drawing={drawing} draft={styleDraft} onDraftChange={setStyleDraft}
          templates={drawing.type === DRAWING_TYPE_FIB_RETRACEMENT ? fibonacciTemplates : trendLineTemplates}
          onTemplatesChange={templates => {
            if (drawing.type === DRAWING_TYPE_FIB_RETRACEMENT) setFibonacciTemplates(templates as typeof fibonacciTemplates);
            else setTrendLineTemplates(templates as typeof trendLineTemplates);
          }} onClose={() => { setStyleDrawingId(null); setStyleDraft(null); }}
          onSave={async style => {
            if (!await updateDrawing(drawing.id, { style })) return false;
            if (drawing.type === DRAWING_TYPE_FIB_RETRACEMENT) setDefaultFibonacciStyle(cloneFibonacciStyle(style as FibonacciRetracementStyle));
            else setDefaultTrendLineStyle({ ...style as TrendLineStyle });
            return true;
          }} /> : null;
      })()}
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction === "paper-clear" ? copy.replaySessions.archiveTitle : copy.replaySessions.restartTitle}
        description={confirmAction === "paper-clear" ? copy.replaySessions.archiveDescription : copy.replaySessions.restartDescription}
        onCancel={() => {
          const suspension = confirmationSuspensionRef.current;
          confirmationSuspensionRef.current = null;
          setConfirmAction(null);
          restorePlayback(suspension);
        }}
        onConfirm={applyConfirmedAction}
      />
      {dateDialogOpen ? <ReplayDateDialog key={displayUtcOffsetMinutes} open currentTime={currentSourceBar?.timestamp ?? dataset.startTime} minimum={dateDialogMinimum} maximum={dataset.endTime} displayUtcOffsetMinutes={displayUtcOffsetMinutes} allowForward={replaySession?.mode === "LIVE_REPLAY"} onClose={() => setDateDialogOpen(false)} onLocate={locateReplayDate} /> : null}
      <ReplayStartDialog
        open={startDialogOpen}
        value={startDialogValue}
        minimum={dateTimeLocalValue(dataset.startTime, dataset.timezone)}
        maximum={dateTimeLocalValue(dataset.endTime, dataset.timezone)}
        timezone={dataset.timezone}
        busy={startDialogBusy}
        error={startError}
        onChange={setStartDialogValue}
        onCancel={closeStartDialog}
        onConfirm={(value) => void applyNewReplayStart(value)}
      />
    </>)}
    </ReplayCorrectionProvider>
  );
}
