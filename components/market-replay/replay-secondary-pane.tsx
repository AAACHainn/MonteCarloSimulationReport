"use client";

import { ChartCandlestick, Loader2, Settings2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { createUuid } from "@/lib/uuid";
import { cloneChartDisplay, type ChartDisplayConfig } from "@/lib/market-replay/chart-display";
import type { ChartHideAfter } from "@/lib/market-replay/chart-hide-after";
import type { ReplayViewportApi, ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";
import { drawingStyleMatchesType, isArrowDrawing, type DrawingGeometry, type DrawingTool, type MarketDrawing, type MarketDrawingStyle } from "@/lib/market-replay/chart-drawings";
import { drawingDeleteLabel, drawingObjectName, drawingSettingsLabel } from "@/lib/market-replay/drawing-presentation";
import { isValidBarCountInterval, isValidBarCountRecentTradingDays } from "@/lib/market-replay/bar-count";
import { DEFAULT_EMA_LINE_STYLE, DEFAULT_EMA_LINE_WIDTH } from "@/lib/market-replay/ema-style";
import type { ReplayCursorMode } from "@/lib/market-replay/cursor-mode";
import { ABR_LENGTH_MAX, ABR_LENGTH_MIN, MAX_EMA_INDICATORS, formatInterval, type DisplaySession, type MarketBarData } from "@/lib/market-replay/types";
import type { ReplayTradeAnnotationData } from "@/lib/paper-trading/types";
import type { PaneId, PaneRect } from "@/lib/market-replay/multi-pane-layout";
import { AbcdSettingsDialog } from "./abcd-settings-dialog";
import { ArrowSettingsDialog } from "./arrow-controls";
import { ChartStyleSettingsDialog } from "./chart-style-settings-dialog";
import { ChartVisibilityMenu } from "./chart-visibility-menu";
import { IndicatorSettingsDialog } from "./indicator-settings-dialog";
import { cloneFibonacciStyle, isValidEmaLength, type TradeAnnotationsPayload } from "./replay-client-shared";
import { cloneLineDrawingStyle, LineSettingsDialog, type LineDrawingStyle } from "./line-settings-dialog";
import { RectangleSettingsDialog } from "./rectangle-controls";
import { ReplayChart } from "./replay-chart";
import { ReplayDrawingToolbar } from "./replay-drawing-toolbar";
import { ReplayPaneFrame } from "./replay-pane-layout";
import { useReplayFetch } from "./replay-session-context";
import { TextSettingsDialog } from "./text-settings-dialog";
import { useDrawingCommands } from "./use-drawing-commands";
import { useDrawingStyleShortcuts } from "./use-drawing-style-shortcuts";
import { useHistoricalDrawings } from "./use-historical-drawings";
import { prepareHistoricalPaneWindow, useHistoricalPaneWindow, type HistoricalPanePreparation } from "./use-historical-pane-window";
import { useHistoricalPaneFormingBar } from "./use-historical-pane-forming-bar";
import { EMA_COLORS, useReplayPreferences } from "./use-replay-preferences";
import type { useReplayCore } from "./use-replay-core";
import { useReplayPaneBars, type createPaneReader } from "./use-replay-pane-bars";
import { useTextDrawingEditor } from "./use-text-drawing-editor";

export type PaneControl = {
  prepare: () => Promise<boolean>;
  capture: () => void;
  restore: () => void;
  armDrawing: (tool: DrawingTool) => Promise<void>;
  inspect: () => number | null;
  hasInteraction: () => boolean;
  loadHistory?: (settings: { period: number; session: DisplaySession; focus: number; formingCursor: number | null; resetView?: boolean },
    signal: AbortSignal) => Promise<HistoricalPanePreparation>;
};
type Core = ReturnType<typeof useReplayCore>;
type ChartContext = Pick<Core, "dataset" | "drawingWriteScope" | "drawingScopeGuard" | "defaultTextStyle" | "textTemplates" | "setTextTemplates" | "setDefaultTextStyle"
  | "defaultTrendLineStyle" | "trendLineTemplates" | "setTrendLineTemplates" | "setDefaultTrendLineStyle"
  | "defaultFibonacciStyle" | "fibonacciTemplates" | "setFibonacciTemplates" | "setDefaultFibonacciStyle"
  | "defaultRectangleStyle" | "rectangleTemplates" | "setRectangleTemplates" | "setDefaultRectangleStyle"
  | "abcdPreferences" | "setAbcdPreferences" | "arrowPreferences" | "setArrowPreferences" | "displayUtcOffsetMinutes" | "chartMarketSession" | "barCountRthSession">;
type LiveSource = Pick<Core, "currentSourceBar" | "replay" | "marketCache" | "paperSnapshot">;
type HistoricalSource = {
  start: number;
  end: number;
  primaryPeriod: number;
  focus: number;
  focusRevision: number;
  prepared?: HistoricalPanePreparation;
  resetView?: boolean;
  annotations: ReplayTradeAnnotationData[];
  boundary: ChartHideAfter | null;
  playbackActive: boolean;
  playing: boolean;
  countdownSeconds: number | null;
  onStart?: (target: ChartHideAfter) => void;
  onHide: (target: ChartHideAfter | null) => void;
  resetViewDisabledReason?: string;
  onResetView: (isCurrent: () => boolean) => void;
};
const t = copy.marketReplay;
const emptyBars: NonNullable<ReturnType<typeof useReplayPaneBars>["data"]>["visibleBars"] = [];
const emptyDrawings: MarketDrawing[] = [];
const noAction = () => {};
const rejectTrade = async () => false;
const noSourceBars: MarketBarData[] = [];

export function ReplaySecondaryPane({ pane, core, rect, active, period, sequence, session, cursorMode, onCursorChange,
  controls, toolbar, register, maximized, canMaximize, onActivate, onMaximize, reader, blocked, webFullscreen, toggleWebFullscreen, live, historical }: {
  pane: PaneId; core: ChartContext; rect?: PaneRect; active: boolean; period: number; sequence: number; session: DisplaySession;
  cursorMode: ReplayCursorMode; onCursorChange: (mode: ReplayCursorMode) => void; controls: HTMLDivElement | null;
  toolbar: HTMLDivElement | null; register: (pane: PaneId, control: PaneControl | null) => void;
  maximized: boolean; canMaximize: boolean; onActivate: () => void; onMaximize: () => void;
  reader: ReturnType<typeof createPaneReader>; blocked: boolean; webFullscreen: boolean; toggleWebFullscreen: () => void;
} & ({ live: LiveSource; historical?: never } | { historical: HistoricalSource; live?: never })) {
  const scope = core.drawingWriteScope + ":" + pane;
  const fetch = useReplayFetch();
  const prefs = useReplayPreferences(core.dataset, pane);
  const state = useHistoricalDrawings({ datasetId: core.dataset.id, fetch, writeScope: scope });
  const [selected, select] = useState<string | null>(null);
  const [tool, arm] = useState<DrawingTool | null>(null);
  const [measuring, measure] = useState(false);
  const [showObjects, setShowObjects] = useState(false);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [lineStyle, setLineStyle] = useState<LineDrawingStyle | null>(null);
  const [chartDraft, setChartDraft] = useState<ChartDisplayConfig | null>(null);
  const [showIndicators, setShowIndicators] = useState(false);
  const [indicatorError, setIndicatorError] = useState<string | null>(null);
  const text = useTextDrawingEditor(scope, prefs.chartVisibility.drawings, state.drawings, core.defaultTextStyle);
  const visible = Boolean(rect);
  const finishText = text.beforeExit;
  useEffect(() => {
    if (!visible) void finishText();
  }, [finishText, visible]);
  const editing = Boolean(text.editor || styleId || chartDraft || showIndicators);
  const disabled = !prefs.chartVisibility.drawings || !state.loaded || state.busy || Boolean(tool) || measuring || editing || blocked;
  const commands = useDrawingCommands({ datasetId: core.dataset.id, scope, fetch, drawings: state.drawings, selectedDrawingId: selected,
    setDrawings: state.setDrawings, select, active, disabled, editor: text.editor, chartApi: text.apiRef,
    displayKey: period + ":" + session, onNudgeError: state.setError });
  useDrawingStyleShortcuts({ drawings: state.drawings, selectedDrawingId: selected, drawingTool: tool, active, scope,
    disabled: disabled || commands.pending || commands.pasteUnconfirmed,
    templates: { TREND_LINE: core.trendLineTemplates, FIB_RETRACEMENT: core.fibonacciTemplates, RECTANGLE: core.rectangleTemplates,
      TEXT: core.textTemplates, AB_CD: core.abcdPreferences.templates,
      ARROW_UP: core.arrowPreferences.ARROW_UP.templates, ARROW_DOWN: core.arrowPreferences.ARROW_DOWN.templates },
    apply: (id, style, action) => state.update(id, { style }, action),
  });
  const inactiveTools = !prefs.chartVisibility.drawings || blocked || commands.pending || commands.pasteUnconfirmed || !state.loaded || state.busy;
  async function armDrawing(next: DrawingTool) {
    if (!visible || !active || inactiveTools || editing || !await text.beforeExit()) return;
    measure(false);
    arm(current => current === next ? null : next);
    select(null);
  }

  const viewport = useRef<ReplayViewportApi | null>(null);
  const savedViewport = useRef<ReplayViewportSnapshot | null>(null);
  const beforeMaximize = useRef<ReplayViewportSnapshot | null>(null);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const desiredViewport = useRef<ReplayViewportSnapshot | null>(null);
  const center = useRef<number | null>(null);
  const [appliedFocus, setAppliedFocus] = useState<number | null>(null);
  const [liveResetRevision, setLiveResetRevision] = useState(0);
  const warmup = Math.max(prefs.abrLength, 0, ...prefs.emaIndicators.filter(indicator => prefs.emaEnabled && indicator.visible).map(indicator => indicator.length));
  const api = useRef<PaneControl>(null);
  api.current = {
    armDrawing,
    inspect: () => center.current,
    hasInteraction: () => Boolean(tool || selected || measuring),
    loadHistory: historical ? ({ period, session, focus, formingCursor, resetView }, signal) => prepareHistoricalPaneWindow(
      { dataset: core.dataset, period, session, warmup, reader, end: historical.end }, focus, formingCursor, signal, resetView) : undefined,
    async prepare() {
      if (commands.pasteUnconfirmed || styleId || chartDraft || showIndicators) return false;
      if (!await text.beforeExit() || !await commands.flushNudges() || state.loaded && state.busy || commands.pending && !commands.nudging) return false;
      arm(null); measure(false);
      return true;
    },
    capture() { beforeMaximize.current = viewport.current?.capture(sequence, !historical || historical.playbackActive) ?? savedViewport.current; },
    restore() {
      desiredViewport.current = beforeMaximize.current;
      savedViewport.current = beforeMaximize.current;
      setRestoreRevision(value => value + 1);
    },
  };
  useLayoutEffect(() => {
    register(pane, {
      prepare: () => api.current!.prepare(), capture: () => api.current!.capture(), restore: () => api.current!.restore(),
      armDrawing: tool => api.current!.armDrawing(tool), inspect: () => api.current!.inspect(),
      hasInteraction: () => api.current!.hasInteraction(),
      loadHistory: api.current?.loadHistory ? (...args) => api.current!.loadHistory!(...args) : undefined,
    });
    return () => register(pane, null);
  }, [pane, register]);

  const marketCache = live?.marketCache;
  const readSource = useCallback((after: number, count: number) => marketCache?.readMemoryBarsAfter(after, count) ?? noSourceBars, [marketCache]);
  const liveWindow = useReplayPaneBars({ visible: visible && Boolean(live), dataset: core.dataset, sequence, period, session,
    calendar: core.chartMarketSession, warmup, scope: scope + ":" + live?.replay?.generation, reader, readSource });
  const following = useCallback(() => savedViewport.current?.mode !== "history", []);
  const historicalWindow = useHistoricalPaneWindow({ visible: visible && Boolean(historical), dataset: core.dataset, period, session, warmup, reader,
    start: historical?.start ?? 0, end: historical?.end ?? 0, focus: historical?.focus ?? 0,
    revision: historical?.focusRevision ?? 0, prepared: historical?.prepared?.window,
    cursor: historical?.playbackActive ? historical.boundary?.bar.lastSequence ?? null : null, following });
  const { data, error: windowError, retry: retryWindow } = historical ? historicalWindow : liveWindow;
  const bars = data?.visibleBars ?? emptyBars;
  const forming = useHistoricalPaneFormingBar({ dataset: core.dataset, period, session, reader, bars, revision: historical?.focusRevision ?? 0,
    prepared: historical?.prepared?.forming,
    cursor: visible && historical?.playbackActive && period > historical.primaryPeriod ? historical.boundary?.bar.lastSequence ?? null : null });
  const boundary = historical?.boundary;
  const hiddenAfter = useMemo(() => forming.bar ? { bar: forming.bar, displayIntervalSeconds: period, displaySession: session } : boundary,
    [boundary, forming.bar, period, session]);
  const error = windowError ?? forming.error;
  const retry = windowError ? retryWindow : forming.retry;
  const firstSequence = bars[0]?.firstSequence;
  const fromSequence = firstSequence === undefined ? undefined : Math.floor(firstSequence / 300) * 300;
  const endRef = useRef(sequence);
  endRef.current = sequence;
  const fill = live?.paperSnapshot?.recentFills[0]?.id;
  const annotationKey = [scope, fromSequence, fill, live?.paperSnapshot?.stats.journalEntryCount, live?.replay?.generation].join(":");
  const [annotations, setAnnotations] = useState<(TradeAnnotationsPayload & { key: string; through: number }) | null>(null);
  const showTrades = Boolean(rect && prefs.chartVisibility.tradeAnnotations && live?.paperSnapshot);
  useEffect(() => {
    if (!showTrades || fromSequence === undefined) return;
    const abort = new AbortController();
    const through = endRef.current;
    void fetch(`/api/market-datasets/${core.dataset.id}/paper-journal/annotations?fromSequence=${fromSequence}&toSequence=${through}`,
      { signal: abort.signal }).then(async response => {
      if (!response.ok) return;
      const payload = await response.json() as TradeAnnotationsPayload;
      if (!abort.signal.aborted) setAnnotations({ ...payload, key: annotationKey, through });
    }).catch(() => {});
    return () => abort.abort();
  }, [annotationKey, core.dataset.id, fetch, fromSequence, showTrades]);

  const visibleDrawings = useMemo(() => {
    if (!prefs.chartVisibility.drawings) return emptyDrawings;
    if (!styleId || !lineStyle) return state.drawings;
    return state.drawings.map(drawing => drawing.id === styleId && drawingStyleMatchesType(drawing.type, lineStyle)
      ? { ...drawing, style: lineStyle } as MarketDrawing : drawing);
  }, [lineStyle, prefs.chartVisibility.drawings, state.drawings, styleId]);

  async function create(type: MarketDrawing["type"], geometry: DrawingGeometry) {
    const styles = { TREND_LINE: core.defaultTrendLineStyle, RECTANGLE: core.defaultRectangleStyle, FIB_RETRACEMENT: core.defaultFibonacciStyle,
      AB_CD: core.abcdPreferences.defaultStyle, ARROW_UP: core.arrowPreferences.ARROW_UP.defaultStyle,
      ARROW_DOWN: core.arrowPreferences.ARROW_DOWN.defaultStyle, TEXT: core.defaultTextStyle };
    const drawing = await state.create({ datasetId: core.dataset.id, pane, type, geometry, style: styles[type] } as Parameters<typeof state.create>[0]);
    if (drawing) select(drawing.id);
  }
  async function remove(id: string) {
    await text.discard(id);
    if (await state.remove(id)) select(current => current === id ? null : current);
  }
  async function openDrawing(id: string, inline = false) {
    if (blocked || commands.pending || (state.busy && !text.editor)) return;
    const isCurrent = core.drawingScopeGuard();
    if (!inline && await text.requestSettings(id)) return;
    if (!isCurrent() || !await text.beforeExit() || !isCurrent()) return;
    const drawing = state.findDrawing(id);
    if (!drawing) return;
    select(id);
    if (drawing.type === "TEXT") { text.open(drawing, inline); return; }
    setStyleId(id);
    if (drawing.type === "TREND_LINE" || drawing.type === "FIB_RETRACEMENT" || drawing.type === "AB_CD") {
      setLineStyle(cloneLineDrawingStyle(drawing.style));
    }
  }
  function closeDrawing() { setStyleId(null); setLineStyle(null); }
  const styleDrawing = state.drawings.find(item => item.id === styleId);
  async function saveLine(style: MarketDrawingStyle) {
    if (!styleDrawing || !await state.update(styleDrawing.id, { style })) return false;
    if (styleDrawing.type === "AB_CD" && "levels" in style) core.setAbcdPreferences(current => ({ ...current, defaultStyle: cloneFibonacciStyle(style) }));
    else if (styleDrawing.type === "FIB_RETRACEMENT" && "levels" in style) core.setDefaultFibonacciStyle(cloneFibonacciStyle(style));
    else if (styleDrawing.type === "TREND_LINE" && "opacity" in style) core.setDefaultTrendLineStyle({ ...style });
    return true;
  }
  return <>
    {active && controls && createPortal(<>
      <ChartVisibilityMenu value={prefs.chartVisibility} includeOrderLines={Boolean(live)} onChange={async value => {
        if (!await text.beforeExit() || !await commands.flushNudges()) return;
        prefs.setChartVisibility(value);
        if (!value.drawings) { arm(null); select(null); setShowObjects(false); }
      }} />
      <Button size="sm" variant="ghost" className="h-8" disabled={commands.pending} aria-label={t.chartStyle}
        onClick={() => setChartDraft(cloneChartDisplay(prefs.chartStyle))}>
        <ChartCandlestick className="h-4 w-4" aria-hidden="true" /><span className="hidden xl:inline">{t.chartStyle}</span>
      </Button>
      <Button size="sm" variant="ghost" className="h-8" disabled={commands.pending} onClick={() => setShowIndicators(true)}>
        <Settings2 className="h-4 w-4" aria-hidden="true" />{t.indicators}
      </Button>
    </>, controls)}
    {active && toolbar && createPortal(<ReplayDrawingToolbar cursorMode={cursorMode} onCursorChange={mode => {
      void text.beforeExit().then(ok => { if (ok) { arm(null); measure(false); select(null); onCursorChange(mode); } });
    }} drawingTool={tool} drawingDisabled={inactiveTools} onArmDrawing={next => void armDrawing(next)}
      measurementArmed={measuring} onToggleMeasurement={() => { arm(null); measure(current => !current); }}
      drawingObjectsOpen={showObjects} onToggleDrawingObjects={() => setShowObjects(current => !current)} history={commands}
      webFullscreen={webFullscreen} onToggleWebFullscreen={toggleWebFullscreen} />, toolbar)}
    {rect ? <ReplayPaneFrame pane={pane} rect={rect} title={core.dataset.symbol + " · " + formatInterval(period)}
      active={active} showHeader canMaximize={canMaximize} maximized={maximized} onActivate={onActivate} onMaximize={onMaximize}>
      <ReplayChart key={restoreRevision} compact observeTrades shortcutsActive={active} cursorMode={cursorMode}
        onToggleMaximize={canMaximize ? onMaximize : undefined}
        datasetId={core.dataset.id} dataRevision={scope + ":" + live?.replay?.generation}
        bars={bars} warmupBars={data?.warmupBars ?? emptyBars} priceTickSize={core.dataset.priceTickSize}
        displayIntervalSeconds={period} displayUtcOffsetMinutes={core.displayUtcOffsetMinutes} sourceIntervalSeconds={core.dataset.sourceIntervalSeconds ?? undefined}
        currentSourceSequence={historical ? historical.boundary?.bar.lastSequence : liveWindow.data?.sequence}
        currentSourceTimestamp={live?.currentSourceBar?.timestamp}
        playbackActive={historical ? historical.playing : live?.replay?.status === "playing"} displaySession={session}
        readOnly={Boolean(historical)} hiddenAfter={hiddenAfter} historicalPlaybackActive={historical?.playbackActive}
        onHiddenAfterChange={historical?.onHide} onStartHistoricalPlayback={historical?.onStart}
        focusSequence={historical && !historical.resetView && appliedFocus !== historical.focusRevision ? historical.focus : null}
        onFocusApplied={historical ? () => setAppliedFocus(historical.focusRevision) : undefined}
        barCountSession={core.chartMarketSession} barCountRthSession={core.barCountRthSession}
        barCountConfig={prefs.chartVisibility.indicators ? prefs.barCountConfig : { ...prefs.barCountConfig, enabled: false }}
        viewportApiRef={viewport} initialViewportSnapshot={desiredViewport.current ?? savedViewport.current}
        viewportResetRevision={historical ? historical.resetView ? historical.focusRevision : undefined : liveResetRevision}
        resetChartViewDisabledReason={historical?.resetViewDisabledReason}
        onResetChartView={isCurrent => {
          if (historical) {
            const target = historical.boundary?.bar.lastSequence ?? historical.end;
            if ((bars[0]?.lastSequence ?? Infinity) <= target && (bars.at(-1)?.lastSequence ?? -1) >= target) return false;
            historical.onResetView(isCurrent);
          } else {
            liveWindow.resumeFollowing();
            setLiveResetRevision(revision => revision + 1);
          }
          return true;
        }}
        onVisibleSequenceRangeChange={range => {
          center.current = Math.floor((range.fromSequence + range.toSequence) / 2);
          if (data) savedViewport.current = viewport.current?.capture(sequence, !historical || historical.playbackActive) ?? savedViewport.current;
          if (historical) historicalWindow.updateViewport(range);
          else liveWindow.updateViewport(savedViewport.current?.mode === "history", range.barsBefore);
          desiredViewport.current = null;
        }}
        drawingApiRef={text.apiRef} drawings={visibleDrawings} drawingTool={tool} onDrawingToolChange={arm} selectedDrawingId={selected}
        onSelectedDrawingIdChange={select} onCreateDrawing={(type, geometry) => void create(type, geometry)}
        onUpdateDrawing={(id, geometry) => void state.update(id, { geometry })} onDeleteDrawing={id => void remove(id)}
        onPlaceText={text.place} onPlaceArrow={(type, anchor) => void create(type, { anchor })}
        onCreateAbcd={geometry => void create("AB_CD", geometry)} onOpenDrawingStyle={openDrawing}
        drawingNudgePreviews={commands.nudgePreviews} drawingEditingLocked={commands.nudging || blocked}
        measurementArmed={measuring} onMeasurementArmedChange={measure}
        trendLineDraftStyle={core.defaultTrendLineStyle} fibonacciDraftStyle={core.defaultFibonacciStyle}
        rectangleDraftStyle={core.defaultRectangleStyle} abcdDraftStyle={core.abcdPreferences.defaultStyle}
        candlestickStyle={(chartDraft ?? prefs.chartStyle).candlestickStyle} chartDisplay={chartDraft ?? prefs.chartStyle}
        gridVisible={prefs.gridVisible} onToggleGrid={() => prefs.setGridVisible(current => !current)}
        emaEnabled={prefs.chartVisibility.indicators && prefs.emaEnabled} emaIndicators={prefs.emaIndicators}
        abrEnabled={prefs.chartVisibility.indicators && prefs.abrEnabled} abrLength={prefs.abrLength}
        volumeVisible={prefs.chartVisibility.indicators && prefs.volumeVisible}
        candleCountdownEnabled={prefs.chartVisibility.indicators && prefs.candleCountdownEnabled && (!historical || historical.countdownSeconds !== null)}
        candleCountdownSeconds={historical?.countdownSeconds}
        paperSnapshot={live?.paperSnapshot ?? null} orderLinesVisible={prefs.chartVisibility.orderLines} paperBusy={false} paperError={null}
        tradeAnnotations={historical?.annotations ?? (annotations?.key === annotationKey && annotations.through <= sequence ? annotations.items : [])}
        tradeAnnotationsTruncated={annotations?.key === annotationKey && annotations.truncated}
        tradeAnnotationsVisible={prefs.chartVisibility.tradeAnnotations}
        onCancelOrder={rejectTrade} onClosePosition={rejectTrade} onSubmitOrder={rejectTrade} onOrderPriceChange={rejectTrade}
        onOpenPaperAccount={noAction} onDraftActiveChange={noAction}
      />
      {(error || state.error) ? <Alert role="alert" className="absolute left-2 top-2 z-30 w-auto max-w-[calc(100%-1rem)] border-negative/40 bg-negative-background px-3 py-2 text-negative">
        <AlertDescription>{error ?? state.error}</AlertDescription>
        {error || !state.loaded ? <Button size="sm" variant="outline" onClick={error ? retry : () => void state.refresh()}>
          {error ? t.multiPane.retry : t.drawingRetry}
        </Button> : null}
      </Alert> : !data || !bars.length ? <p role="status" className="pointer-events-none absolute inset-x-2 top-3 flex items-center gap-2 text-xs text-muted-foreground">
        {sequence >= 0 && !data ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {sequence >= 0 && !data ? t.multiPane.loading : t.multiPane.empty}
      </p> : null}
      {active && showObjects ? <aside className="absolute right-2 top-2 z-40 flex max-h-[calc(100%-1rem)] w-64 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <header className="flex items-center gap-1 border-b px-2 py-1">
          <h3 className="mr-auto text-sm font-semibold">{t.drawingObjects}</h3>
          <Button size="sm" variant="ghost" disabled={inactiveTools || !state.drawings.length} className="text-negative"
            onClick={() => void text.discard().then(state.clear).then(ok => { if (ok) select(null); })}>{t.clearDrawingsShort}</Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t.closeDrawingObjects} onClick={() => setShowObjects(false)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>
        <div className="overflow-y-auto p-1">
          {state.drawings.map((drawing, index) => <div key={drawing.id} className="flex items-center">
            <Button size="sm" variant={selected === drawing.id ? "secondary" : "ghost"} className="min-w-0 flex-1 justify-start"
              data-drawing-nudge-id={drawing.id} aria-pressed={selected === drawing.id}
              onClick={() => select(drawing.id)} onDoubleClick={() => openDrawing(drawing.id)}>
              <span className="truncate">{drawingObjectName(drawing, index + 1)}</span>
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={inactiveTools}
              data-text-settings={drawing.id} aria-label={drawingSettingsLabel(drawing)} onClick={() => openDrawing(drawing.id)}>
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-negative" disabled={inactiveTools}
              data-text-delete={drawing.id} aria-label={drawingDeleteLabel(drawing)} onClick={() => void remove(drawing.id)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>)}
          {!state.drawings.length ? <p className="p-3 text-xs text-muted-foreground">{t.drawingObjectsEmpty}</p> : null}
        </div>
      </aside> : null}
    </ReplayPaneFrame> : null}
    {text.editor ? <TextSettingsDialog key={text.editor.key} editor={text.editor} apiRef={text.apiRef}
      inlineAvailable={visible} onHistoryGroup={commands.textGroup}
      onAdopt={text.adopt} register={text.register} isCurrent={text.guard()} templates={core.textTemplates} onTemplatesChange={core.setTextTemplates}
      onPreview={text.preview} onClose={text.close} onRemove={state.removeText}
      onSave={async (...args) => { const drawing = await state.saveText(...args); select(drawing.id); core.setDefaultTextStyle(drawing.style); return drawing; }} /> : null}
    {styleDrawing && isArrowDrawing(styleDrawing) ? <ArrowSettingsDialog key={styleDrawing.id} drawing={styleDrawing}
      templates={core.arrowPreferences[styleDrawing.type].templates}
      onTemplatesChange={templates => core.setArrowPreferences(current => ({ ...current, [styleDrawing.type]: { ...current[styleDrawing.type], templates } }))}
      onClose={closeDrawing} onSave={async style => {
        const saved = await state.update(styleDrawing.id, { style });
        if (saved) core.setArrowPreferences(current => ({ ...current, [styleDrawing.type]: { ...current[styleDrawing.type], defaultStyle: style } }));
        return saved;
      }} /> : null}
    {styleDrawing?.type === "RECTANGLE" ? <RectangleSettingsDialog key={styleDrawing.id} drawing={styleDrawing}
      templates={core.rectangleTemplates} onTemplatesChange={core.setRectangleTemplates} onClose={closeDrawing}
      onSave={async style => { const saved = await state.update(styleDrawing.id, { style }); if (saved) core.setDefaultRectangleStyle(style); return saved; }} /> : null}
    {styleDrawing?.type === "AB_CD" && lineStyle && "levels" in lineStyle ? <AbcdSettingsDialog key={styleDrawing.id}
      draft={lineStyle} onDraftChange={setLineStyle} templates={core.abcdPreferences.templates}
      onTemplatesChange={templates => core.setAbcdPreferences(current => ({ ...current, templates }))} onClose={closeDrawing} onSave={saveLine} /> : null}
    {(styleDrawing?.type === "TREND_LINE" || styleDrawing?.type === "FIB_RETRACEMENT") && lineStyle ? <LineSettingsDialog key={styleDrawing.id}
      drawing={styleDrawing} draft={lineStyle} onDraftChange={setLineStyle}
      templates={styleDrawing.type === "FIB_RETRACEMENT" ? core.fibonacciTemplates : core.trendLineTemplates}
      onTemplatesChange={templates => {
        if (styleDrawing.type === "FIB_RETRACEMENT") core.setFibonacciTemplates(templates as typeof core.fibonacciTemplates);
        else core.setTrendLineTemplates(templates as typeof core.trendLineTemplates);
      }} onClose={closeDrawing} onSave={saveLine} /> : null}
    <ChartStyleSettingsDialog open={chartDraft !== null} draft={chartDraft} onDraftChange={setChartDraft}
      onClose={() => setChartDraft(null)} onConfirm={style => { prefs.setChartStyle(style); setChartDraft(null); }} />
    <IndicatorSettingsDialog open={showIndicators} onClose={() => { setShowIndicators(false); setIndicatorError(null); }}
      candleCountdown={{ enabled: prefs.candleCountdownEnabled, onChange: prefs.setCandleCountdownEnabled }}
      volumeVisible={prefs.volumeVisible} onVolumeVisibleChange={prefs.setVolumeVisible}
      barCountConfig={prefs.barCountConfig} setBarCountConfig={prefs.setBarCountConfig}
      onBarCountRecentTradingDaysChange={recentTradingDays => {
        if (!isValidBarCountRecentTradingDays(recentTradingDays)) return false;
        prefs.setBarCountConfig(current => ({ ...current, recentTradingDays })); return true;
      }} onBarCountIntervalChange={interval => {
        if (!isValidBarCountInterval(interval)) return false;
        prefs.setBarCountConfig(current => ({ ...current, interval })); return true;
      }} barCountError={null}
      abrEnabled={prefs.abrEnabled} onAbrEnabledChange={prefs.setAbrEnabled} abrLength={prefs.abrLength}
      onAbrLengthChange={length => {
        if (!Number.isInteger(length) || length < ABR_LENGTH_MIN || length > ABR_LENGTH_MAX) return false;
        prefs.setAbrLength(length); return true;
      }} abrError={null}
      emaEnabled={prefs.emaEnabled} onEmaEnabledChange={prefs.setEmaEnabled} emaIndicators={prefs.emaIndicators} setEmaIndicators={prefs.setEmaIndicators}
      onEmaLengthChange={(id, length) => {
        if (!isValidEmaLength(length)) return false;
        prefs.setEmaIndicators(current => current.map(indicator => indicator.id === id ? { ...indicator, length } : indicator)); return true;
      }} onAddEma={() => {
        if (prefs.emaIndicators.length >= MAX_EMA_INDICATORS) { setIndicatorError(t.emaLimit(MAX_EMA_INDICATORS)); return; }
        const length = [20, 60, 200, 9, 12, 26, 50, 100].find(size => !prefs.emaIndicators.some(indicator => indicator.length === size)) ?? 20;
        prefs.setEmaIndicators(current => [...current, { id: createUuid(), length, visible: true, color: EMA_COLORS[current.length % EMA_COLORS.length],
          lineWidth: DEFAULT_EMA_LINE_WIDTH, lineStyle: DEFAULT_EMA_LINE_STYLE }]);
        setIndicatorError(null);
      }} emaError={indicatorError} />
  </>;
}
