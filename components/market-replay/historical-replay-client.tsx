"use client";
import { ArrowSettingsDialog } from "./arrow-controls";
import { useArrowPreferences } from "./use-arrow-preferences";
import { useAbcdPreferences } from "./use-abcd-preferences";
import { isArrowDrawing } from "@/lib/market-replay/chart-drawings";
import { useReplayFetch, useReplaySession } from "./replay-session-context";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Loader2, Palette, Settings2, Trash2, X } from "lucide-react";
import { ReplayDrawingToolbar } from "./replay-drawing-toolbar";
import { useReplayCursorPreference } from "./use-replay-cursor-preference";
import type { ReplayCursorMode } from "@/lib/market-replay/cursor-mode";
import { ReplayChart, type ReplayVisibleSequenceRange } from "@/components/market-replay/replay-chart";
import { IndicatorSettingsDialog } from "@/components/market-replay/indicator-settings-dialog";
import { ChartVisibilityMenu } from "@/components/market-replay/chart-visibility-menu";
import { DisplayIntervalControls } from "@/components/market-replay/display-interval-controls";
import { useReplayPreferences } from "@/components/market-replay/use-replay-preferences";
import { useHistoricalDrawings } from "./use-historical-drawings";
import { RectangleSettingsDialog } from "./rectangle-controls";
import { AbcdSettingsDialog } from "./abcd-settings-dialog";
import { LineSettingsDialog, cloneLineDrawingStyle, type LineDrawingStyle } from "./line-settings-dialog";
import { hasVisibleReplayDialog, isReplayShortcutInputTarget, replayDrawingShortcutKey } from "@/lib/market-replay/keyboard-shortcuts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/i18n";
import { TextSettingsDialog } from "./text-settings-dialog";
import { useTextDrawingEditor } from "./use-text-drawing-editor";
import { drawingObjectName, drawingSettingsLabel, drawingDeleteLabel } from "@/lib/market-replay/drawing-presentation";
import { isValidBarCountInterval, isValidBarCountRecentTradingDays } from "@/lib/market-replay/bar-count";
import type { CandlestickStyle } from "@/lib/market-replay/candlestick-style";
import type { ReplayChartVisibility } from "@/lib/market-replay/chart-visibility";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import {
  DRAWING_TYPE_FIB_RETRACEMENT,
  DRAWING_TYPE_RECTANGLE,
  DRAWING_TYPE_TEXT, twoPointDrawingInput, type TwoPointDrawingTool, type DrawingGeometry,
  rectangleStyleSchema,
  drawingStyleMatchesType,
  type MarketDrawing,
  type FibonacciRetracementStyle,
  type RectangleStyle,
  type DrawingTool,
  type TrendLineGeometry,
} from "@/lib/market-replay/chart-drawings";
import { historicalWindowFocusSequence, mergeHistoricalBars } from "@/lib/market-replay/historical-window";
import { datasetSession } from "@/lib/market-replay/dataset";
import type {
  AggregatedMarketBarData,
  DisplaySession,
  MarketDatasetSummary,
} from "@/lib/market-replay/types";
import {
  ABR_LENGTH_MAX,
  ABR_LENGTH_MIN,
  BAR_COUNT_INTERVAL_MAX,
  BAR_COUNT_INTERVAL_MIN,
  BAR_COUNT_RECENT_TRADING_DAYS_MAX,
  BAR_COUNT_RECENT_TRADING_DAYS_MIN,
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  MAX_EMA_INDICATORS,
  isValidDisplayInterval,
} from "@/lib/market-replay/types";
import type { ReplayTradeAnnotationData } from "@/lib/paper-trading/types";

type HistoricalReplaySession = {
  id: string;
  startSequence: number;
  endSequence: number;
  displayIntervalSeconds: number;
  displaySession: DisplaySession;
};

type WindowPayload = {
  visibleBars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
};

type AnnotationPayload = {
  items: ReplayTradeAnnotationData[];
  truncated: boolean;
};

const VISIBLE_BAR_COUNT = 1_200;
const noOp = () => undefined;
const noOpAsync = async () => false;

export function HistoricalReplayClient({
  dataset,
  session,
  focusSequence,
}: {
  dataset: MarketDatasetSummary;
  session: HistoricalReplaySession;
  focusSequence: number;
}) {
  const [cursorMode, setCursorMode] = useReplayCursorPreference();
  const fetch = useReplayFetch();
  const replaySession = useReplaySession();
  const [displayIntervalSeconds, setDisplayIntervalSeconds] = useState(session.displayIntervalSeconds);
  const requestedIntervalRef = useRef(session.displayIntervalSeconds);
  const displayedIntervalRef = useRef(session.displayIntervalSeconds);
  const mainWindowAbortRef = useRef<AbortController | null>(null);
  const visibleRangeRef = useRef<ReplayVisibleSequenceRange | null>(null);
  const [bars, setBars] = useState<AggregatedMarketBarData[]>([]);
  const [chartFocusSequence, setChartFocusSequence] = useState<number | null>(focusSequence);
  const [warmupBars, setWarmupBars] = useState<AggregatedMarketBarData[]>([]);
  const [annotations, setAnnotations] = useState<ReplayTradeAnnotationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [measurementArmed, setMeasurementArmed] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null);
  const [drawingObjectsOpen, setDrawingObjectsOpen] = useState(false);
  const drawingState = useHistoricalDrawings({ datasetId: dataset.id, fetch,
    writeScope: dataset.id + ":" + replaySession?.id + ":" + replaySession?.activeProjectionId });
  const { drawings, loaded: drawingsLoaded, busy: drawingBusy, error: drawingError } = drawingState;
  const [rectangleStyleId, setRectangleStyleId] = useState<string | null>(null);
  const [arrowStyleId, setArrowStyleId] = useState<string | null>(null);
  const { arrowPreferences, setArrowPreferences } = useArrowPreferences();
  const { abcdPreferences, setAbcdPreferences } = useAbcdPreferences();
  const [styleDrawingId, setStyleDrawingId] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState<LineDrawingStyle | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"candlesticks" | "indicators" | null>(null);
  const [candlestickStyleDraft, setCandlestickStyleDraft] = useState<CandlestickStyle | null>(null);
  const [indicatorError, setIndicatorError] = useState<string | null>(null);
  const annotationAbortRef = useRef<AbortController | null>(null);
  const initialLoadCompletedRef = useRef(false);
  const windowAbortRef = useRef<AbortController | null>(null);
  const windowBusyRef = useRef(false);
  const exhaustedEdgesRef = useRef({ left: false, right: false });
  const [windowLoading, setWindowLoading] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);
  const {
    candlestickStyle,
    setCandlestickStyle,
    emaEnabled,
    setEmaEnabled,
    emaIndicators,
    setEmaIndicators,
    abrEnabled,
    setAbrEnabled,
    abrLength,
    setAbrLength,
    gridVisible,
    volumeVisible,
    setVolumeVisible,
    barCountConfig,
    setBarCountConfig,
    chartVisibility,
    setChartVisibility,
    defaultRectangleStyle, setDefaultRectangleStyle, rectangleTemplates, setRectangleTemplates,
    defaultTextStyle, setDefaultTextStyle, textTemplates, setTextTemplates,
    defaultTrendLineStyle,
    setDefaultTrendLineStyle, trendLineTemplates, setTrendLineTemplates,
    defaultFibonacciStyle,
    setDefaultFibonacciStyle, fibonacciTemplates, setFibonacciTemplates,
    displayUtcOffsetMinutes,
  } = useReplayPreferences(dataset);
  const textDrawing = useTextDrawingEditor(
    dataset.id + ":" + replaySession?.id + ":" + replaySession?.activeProjectionId,
    chartVisibility.drawings, drawings, defaultTextStyle);
  const { open: openTextDrawing } = textDrawing;
  const { beforeExit: finishText, discard: discardText, requestSettings: requestTextSettings } = textDrawing;
  async function selectCursor(mode: ReplayCursorMode) {
    if (!await finishText()) return;
    setDrawingTool(null);
    setMeasurementArmed(false);
    setSelectedDrawingId(null);
    setCursorMode(mode);
  }
  const visibleBarCountConfig = useMemo(() => (
    chartVisibility.indicators ? barCountConfig : { ...barCountConfig, enabled: false }
  ), [barCountConfig, chartVisibility.indicators]);
  const visibleDrawings = useMemo(
    () => chartVisibility.drawings ? drawings.map(drawing => drawing.id === styleDrawingId && styleDraft && drawingStyleMatchesType(drawing.type, styleDraft)
      ? { ...drawing, style: styleDraft } as MarketDrawing : drawing) : [],
    [chartVisibility.drawings, drawings, styleDrawingId, styleDraft],
  );
  const indicatorWarmupCount = Math.max(
    abrEnabled ? abrLength : 0,
    emaEnabled ? Math.max(0, ...emaIndicators.filter((indicator) => indicator.visible).map((indicator) => indicator.length)) : 0,
  );
  const extendHistoryWindow = useCallback(async (range: ReplayVisibleSequenceRange) => {
    if (windowBusyRef.current || !bars.length) return;
    const first = bars[0];
    const last = bars[bars.length - 1];
    const nearRight = bars.findIndex((bar) => bar.lastSequence >= range.toSequence) >= bars.length - 100;
    const direction = range.barsBefore < 100 && !exhaustedEdgesRef.current.left && first.firstSequence > session.startSequence
      ? "left" : nearRight && !exhaustedEdgesRef.current.right && last.lastSequence < session.endSequence ? "right" : null;
    if (!direction) return;
    const controller = new AbortController();
    windowAbortRef.current = controller;
    windowBusyRef.current = true;
    setWindowLoading(true);
    setWindowError(null);
    const params = new URLSearchParams({
      displayIntervalSeconds: String(displayIntervalSeconds),
      displaySession: session.displaySession,
      endSequence: String(direction === "left" ? first.lastSequence : session.endSequence),
      visibleCount: String(VISIBLE_BAR_COUNT),
      warmupCount: String(Math.min(EMA_LENGTH_MAX, indicatorWarmupCount)),
    });
    if (direction === "right") params.set("focusSequence", String(last.lastSequence + 1));
    try {
      const readWindow = async () => {
        const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
        const payload = await response.json() as WindowPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error);
        return payload;
      };
      let data = await readWindow();
      // Session-filtered charts can have long overnight/weekend gaps in source sequences.
      let searchDistance = VISIBLE_BAR_COUNT;
      while (direction === "right" && !data.visibleBars.some((bar) => bar.lastSequence > last.lastSequence)
        && Number(params.get("focusSequence")) < session.endSequence) {
        params.set("focusSequence", String(Math.min(session.endSequence, last.lastSequence + searchDistance)));
        searchDistance *= 2;
        data = await readWindow();
      }
      if (controller.signal.aborted) return;
      if (direction === "left" && !data.visibleBars.some((bar) => bar.firstSequence < first.firstSequence)) exhaustedEdgesRef.current.left = true;
      if (direction === "right" && !data.visibleBars.some((bar) => bar.lastSequence > last.lastSequence)) exhaustedEdgesRef.current.right = true;
      // Additional history must preserve the user's viewport rather than repeat initial positioning.
      setChartFocusSequence(null);
      setBars((current) => mergeHistoricalBars(current, data.visibleBars));
      if (direction === "left") setWarmupBars(data.warmupBars);
    } catch (cause) {
      if (!controller.signal.aborted) setWindowError(cause instanceof Error && cause.message
        ? cause.message : copy.paperTrading.historicalReplayLoadFailed);
    } finally {
      if (!controller.signal.aborted) {
        windowBusyRef.current = false;
        setWindowLoading(false);
      }
    }
  }, [bars, dataset.id, displayIntervalSeconds, indicatorWarmupCount, session.displaySession, session.endSequence, session.startSequence, fetch]);

  const handleVisibleSequenceRange = useCallback((range: ReplayVisibleSequenceRange) => {
    visibleRangeRef.current = range;
    void extendHistoryWindow(range);
  }, [extendHistoryWindow]);

  const barCountSession = useMemo(
    () => resolveDisplaySession(dataset, session.displaySession) ?? datasetSession(dataset),
    [dataset, session.displaySession],
  );

  const armDrawing = useCallback(async (tool: DrawingTool) => {
    if (!await finishText()) return;
    if (!drawingsLoaded || drawingBusy) return;
    setMeasurementArmed(false);
    setChartVisibility((current) => current.drawings ? current : { ...current, drawings: true });
    setDrawingTool(tool);
    setSelectedDrawingId(null);
  }, [setChartVisibility, drawingsLoaded, drawingBusy, finishText]);

  const changeChartVisibility = useCallback(async (next: ReplayChartVisibility) => {
    if (!next.drawings && !await finishText()) return;
    setChartVisibility(next);
    if (!next.drawings) {
      setDrawingTool(null);
      setDrawingObjectsOpen(false);
      setSelectedDrawingId(null);
    }
  }, [setChartVisibility, finishText]);

  const createDrawing = async (type: TwoPointDrawingTool, geometry: TrendLineGeometry) => {
    const drawing = await drawingState.create(twoPointDrawingInput(dataset.id, type, geometry, {
      rectangle: defaultRectangleStyle, trend: defaultTrendLineStyle, fibonacci: defaultFibonacciStyle,
    }));
    if (drawing) setSelectedDrawingId(drawing.id);
  };

  const updateDrawing = (id: string, geometry: DrawingGeometry) => { void drawingState.update(id, { geometry }); };

  const openDrawingStyle = useCallback(async (id: string, inlineText = false) => {
    if (!inlineText && await requestTextSettings(id)) return;
    if (!await finishText()) return;
    const drawing = drawings.find(item => item.id === id);
    if (!drawing || drawingBusy || id.startsWith("temporary-")) return;
    setSelectedDrawingId(id);
    if (drawing.type === DRAWING_TYPE_TEXT) { openTextDrawing(drawing, inlineText); return; }
    if (drawing.type === DRAWING_TYPE_RECTANGLE) { setRectangleStyleId(id); return; }
    if (isArrowDrawing(drawing)) { setArrowStyleId(id); return; }
    setStyleDrawingId(id); setStyleDraft(cloneLineDrawingStyle(drawing.style));
  }, [drawings, drawingBusy, openTextDrawing, finishText, requestTextSettings]);

  const deleteDrawing = async (id: string) => {
    await discardText(id);
    if (await drawingState.remove(id)) {
      setSelectedDrawingId((current) => current === id ? null : current);
      if (styleDrawingId === id) { setStyleDrawingId(null); setStyleDraft(null); }
    }
  };

  const saveRectangleStyle = async (id: string, style: RectangleStyle) => {
    if (!rectangleStyleSchema.safeParse(style).success) return false;
    if (!await drawingState.update(id, { style })) return false;
    setDefaultRectangleStyle({ ...style }); return true;
  };

  const loadAnnotations = useCallback(async (fromSequence: number, toSequence: number) => {
    annotationAbortRef.current?.abort();
    const controller = new AbortController();
    annotationAbortRef.current = controller;
    const params = new URLSearchParams({
      fromSequence: String(fromSequence),
      toSequence: String(toSequence),
      journalSessionId: session.id,
    });
    try {
      const response = await fetch(
        `/api/market-datasets/${dataset.id}/paper-journal/annotations?${params}`,
        { signal: controller.signal },
      );
      const data = await response.json() as AnnotationPayload & { error?: string };
      if (!response.ok) throw new Error(data.error);
      if (controller.signal.aborted) return false;
      setAnnotations(data.items);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error && cause.message
          ? cause.message
          : copy.paperTrading.historicalReplayLoadFailed);
      }
      return false;
    }
  }, [dataset.id, session.id, fetch]);

  const loadHistoryWindow = useCallback(async (seconds: number, targetSequence: number) => {
    mainWindowAbortRef.current?.abort();
    windowAbortRef.current?.abort();
    windowBusyRef.current = true;
    const controller = new AbortController();
    mainWindowAbortRef.current = controller;
    const initial = !initialLoadCompletedRef.current;
    if (initial) setLoading(true);
    else setWindowLoading(true);
    setWindowError(null);
    const params = new URLSearchParams({
      displayIntervalSeconds: String(seconds),
      displaySession: session.displaySession,
      endSequence: String(session.endSequence),
      focusSequence: String(targetSequence),
      visibleCount: String(VISIBLE_BAR_COUNT),
      warmupCount: String(Math.min(EMA_LENGTH_MAX, indicatorWarmupCount)),
    });
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
      const data = await response.json() as WindowPayload & { error?: string };
      if (!response.ok) throw new Error(data.error);
      if (controller.signal.aborted) return false;
      // Commit the new period and its bars together; old requests must never mix timelines.
      exhaustedEdgesRef.current = { left: false, right: false };
      setChartFocusSequence(initial ? targetSequence : null);
      displayedIntervalRef.current = seconds;
      setDisplayIntervalSeconds(seconds);
      setBars(data.visibleBars);
      setWarmupBars(data.warmupBars);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = cause instanceof Error && cause.message ? cause.message : copy.paperTrading.historicalReplayLoadFailed;
        if (initial) setError(message);
        else setWindowError(message);
        requestedIntervalRef.current = displayedIntervalRef.current;
      }
      return false;
    } finally {
      if (mainWindowAbortRef.current === controller) {
        mainWindowAbortRef.current = null;
        windowBusyRef.current = false;
        initialLoadCompletedRef.current = true;
        setLoading(false);
        setWindowLoading(false);
      }
    }
  }, [dataset.id, indicatorWarmupCount, session.displaySession, session.endSequence, fetch]);

  const changeDisplayInterval = useCallback(async (seconds: number) => {
    if (!dataset.sourceIntervalSeconds || !isValidDisplayInterval(dataset.sourceIntervalSeconds, seconds)) {
      setWindowError(copy.marketReplay.invalidDisplayInterval);
      return false;
    }
    if (seconds === displayIntervalSeconds && mainWindowAbortRef.current === null) return true;
    requestedIntervalRef.current = seconds;
    const target = historicalWindowFocusSequence(visibleRangeRef.current, focusSequence, session.startSequence, session.endSequence);
    return loadHistoryWindow(seconds, target);
  }, [dataset.sourceIntervalSeconds, displayIntervalSeconds, focusSequence, loadHistoryWindow, session.endSequence, session.startSequence]);

  useEffect(() => {
    const target = historicalWindowFocusSequence(visibleRangeRef.current, focusSequence, session.startSequence, session.endSequence);
    void loadHistoryWindow(requestedIntervalRef.current, target);
    return () => mainWindowAbortRef.current?.abort();
  }, [focusSequence, loadHistoryWindow, session.endSequence, session.startSequence]);

  useEffect(() => {
    void loadAnnotations(session.startSequence, session.endSequence);
    return () => annotationAbortRef.current?.abort();
  }, [loadAnnotations, session.endSequence, session.startSequence]);

  useEffect(() => () => {
    annotationAbortRef.current?.abort();
    windowAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = replayDrawingShortcutKey(event);
      if (!key || hasVisibleReplayDialog() || event.repeat || settingsDialog || rectangleStyleId || styleDrawingId || textDrawing.editor || drawingBusy || !drawingsLoaded || isReplayShortcutInputTarget(event.target)) return;
      event.preventDefault();
      armDrawing(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armDrawing, settingsDialog, rectangleStyleId, styleDrawingId, textDrawing.editor, drawingBusy, drawingsLoaded]);

  function updateAbrLength(value: number) {
    if (!Number.isInteger(value) || value < ABR_LENGTH_MIN || value > ABR_LENGTH_MAX) {
      setIndicatorError(copy.marketReplay.abrLengthRange(ABR_LENGTH_MIN, ABR_LENGTH_MAX));
      return false;
    }
    setAbrLength(value);
    setIndicatorError(null);
    return true;
  }

  function updateEmaLength(id: string, value: number) {
    if (!Number.isInteger(value) || value < EMA_LENGTH_MIN || value > EMA_LENGTH_MAX) {
      setIndicatorError(copy.marketReplay.emaLengthRange(EMA_LENGTH_MIN, EMA_LENGTH_MAX));
      return false;
    }
    setEmaIndicators((current) => current.map((indicator) => indicator.id === id
      ? { ...indicator, length: value }
      : indicator));
    setIndicatorError(null);
    return true;
  }

  function updateBarCountRecentTradingDays(value: number) {
    if (!isValidBarCountRecentTradingDays(value)) {
      setIndicatorError(copy.marketReplay.barCountRecentTradingDaysRange(
        BAR_COUNT_RECENT_TRADING_DAYS_MIN,
        BAR_COUNT_RECENT_TRADING_DAYS_MAX,
      ));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, recentTradingDays: value }));
    setIndicatorError(null);
    return true;
  }

  function updateBarCountInterval(value: number) {
    if (!isValidBarCountInterval(value)) {
      setIndicatorError(copy.marketReplay.barCountIntervalRange(BAR_COUNT_INTERVAL_MIN, BAR_COUNT_INTERVAL_MAX));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, interval: value }));
    setIndicatorError(null);
    return true;
  }

  function addEma() {
    if (emaIndicators.length >= MAX_EMA_INDICATORS) return;
    const sequence = Date.now().toString(36);
    setEmaIndicators((current) => [...current, {
      id: `history-ema-${sequence}`,
      length: 20,
      color: "#0F766E",
      lineWidth: 2,
      lineStyle: "SOLID",
      visible: true,
    }]);
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" aria-busy="true">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {copy.marketReplay.loading}
    </div>;
  }

  if (error) {
    return <div className="p-4">
      <Alert className="border-red-200 bg-red-50" role="alert">
        <AlertTitle>{copy.common.error}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    </div>;
  }

  return <>
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 [&>*]:shrink-0">
        <DisplayIntervalControls
          value={displayIntervalSeconds}
          sourceIntervalSeconds={dataset.sourceIntervalSeconds}
          disabled={windowLoading}
          onChange={changeDisplayInterval}
        />
        <ChartVisibilityMenu value={chartVisibility} onChange={changeChartVisibility} />
        <Button type="button" variant={settingsDialog === "candlesticks" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => { setCandlestickStyleDraft({ ...candlestickStyle }); setSettingsDialog("candlesticks"); }}>
          <Palette className="h-4 w-4" />{copy.marketReplay.candlestickStyle}
        </Button>
        <Button type="button" variant={settingsDialog === "indicators" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setSettingsDialog("indicators")}>
          <Settings2 className="h-4 w-4" />{copy.marketReplay.indicators}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <ReplayDrawingToolbar cursorMode={cursorMode} onCursorChange={mode => void selectCursor(mode)} drawingTool={drawingTool} drawingDisabled={!drawingsLoaded || drawingBusy}
          onArmDrawing={tool => void armDrawing(tool)} measurementArmed={measurementArmed}
          onToggleMeasurement={() => { setDrawingTool(null); setMeasurementArmed(current => !current); }}
          drawingObjectsOpen={drawingObjectsOpen} onToggleDrawingObjects={() => setDrawingObjectsOpen(current => !current)} />
      <div className="relative min-h-0 min-w-0 flex-1" aria-busy={windowLoading || drawingBusy}>
        {drawingError ? <Alert className="absolute left-3 top-3 z-50 w-auto border-red-200 bg-red-50" role="alert"><AlertTitle>{copy.marketReplay.drawingSyncErrorTitle}</AlertTitle><AlertDescription>{drawingError}</AlertDescription></Alert> : null}
        {windowLoading ? <div className="absolute left-3 top-3 z-50 flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-xs text-slate-600" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{copy.marketReplay.loading}</div> : null}
        {windowError ? <Alert className="absolute left-3 top-3 z-50 w-auto border-red-200 bg-red-50" role="alert"><AlertTitle>{copy.common.error}</AlertTitle><AlertDescription>{windowError}</AlertDescription></Alert> : null}
        <ReplayChart
          cursorMode={cursorMode}
          datasetId={dataset.id}
          priceTickSize={dataset.priceTickSize}
          bars={bars}
          warmupBars={warmupBars}
          displayUtcOffsetMinutes={displayUtcOffsetMinutes}
          displayIntervalSeconds={displayIntervalSeconds}
          sourceIntervalSeconds={dataset.sourceIntervalSeconds ?? undefined}
          measurementArmed={measurementArmed}
          candlestickStyle={candlestickStyleDraft ?? candlestickStyle}
          onMeasurementArmedChange={setMeasurementArmed}
          drawingTool={drawingsLoaded && !drawingBusy ? drawingTool : null}
          onDrawingToolChange={setDrawingTool}
            onPlaceText={textDrawing.place} drawingApiRef={textDrawing.apiRef}
          trendLineDraftStyle={defaultTrendLineStyle}
          fibonacciDraftStyle={defaultFibonacciStyle}
          rectangleDraftStyle={defaultRectangleStyle}
          abcdDraftStyle={abcdPreferences.defaultStyle}
          onCreateAbcd={async geometry => {
            const style = cloneLineDrawingStyle(abcdPreferences.defaultStyle) as FibonacciRetracementStyle;
            const drawing = await drawingState.create({ datasetId: dataset.id, type: "AB_CD", geometry, style });
            if (drawing) setSelectedDrawingId(drawing.id);
          }}
          onPlaceArrow={async (type, anchor) => {
            const drawing = await drawingState.create({ datasetId: dataset.id, type, geometry: { anchor }, style: { ...arrowPreferences[type].defaultStyle } });
            if (drawing) setSelectedDrawingId(drawing.id);
          }}
          drawings={visibleDrawings}
          selectedDrawingId={selectedDrawingId}
          onSelectedDrawingIdChange={setSelectedDrawingId}
          onCreateDrawing={createDrawing}
          onUpdateDrawing={updateDrawing}
          onDeleteDrawing={deleteDrawing}
          onOpenDrawingStyle={openDrawingStyle}
          emaEnabled={chartVisibility.indicators && emaEnabled}
          emaIndicators={emaIndicators}
          abrEnabled={chartVisibility.indicators && abrEnabled}
          abrLength={abrLength}
          volumeVisible={chartVisibility.indicators && volumeVisible}
          gridVisible={gridVisible}
          displaySession={session.displaySession}
          barCountSession={barCountSession}
          barCountConfig={visibleBarCountConfig}
          paperSnapshot={null}
          tradeAnnotations={annotations}
          tradeAnnotationsTruncated={false}
          tradeAnnotationsVisible={chartVisibility.tradeAnnotations}
          focusSequence={chartFocusSequence}
          onVisibleSequenceRangeChange={handleVisibleSequenceRange}
          readOnly
          paperBusy={false}
          paperError={null}
          onSubmitOrder={noOpAsync}
          onOrderPriceChange={noOpAsync}
          onCancelOrder={noOpAsync}
          onClosePosition={noOpAsync}
          onDraftActiveChange={noOp}
          onOpenPaperAccount={noOp}
        />
        {drawingObjectsOpen ? <aside className="absolute right-3 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <ListTree className="h-4 w-4 text-slate-500" /><h3 className="text-sm font-semibold text-slate-950">{copy.marketReplay.drawingObjects}</h3>
            <Button type="button" variant="ghost" size="sm" disabled={!drawingsLoaded || drawingBusy || !drawings.length}
              data-text-delete="all" aria-label={copy.marketReplay.clearDrawings} className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={async () => { await discardText(); if (await drawingState.clear()) { setSelectedDrawingId(null); setRectangleStyleId(null); setStyleDrawingId(null); setStyleDraft(null); } }}>{copy.marketReplay.clearDrawingsShort}</Button>
            <button type="button" className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label={copy.marketReplay.closeDrawingObjects} onClick={() => setDrawingObjectsOpen(false)}><X className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {drawings.length ? drawings.map((drawing, index) => <div key={drawing.id} className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${selectedDrawingId === drawing.id ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}>
              <button type="button" className="min-w-0 flex-1 truncate text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => setSelectedDrawingId(drawing.id)} onDoubleClick={() => openDrawingStyle(drawing.id)}>
                {drawingObjectName(drawing, index + 1)}
              </button>
              <Button type="button" disabled={drawingBusy} variant="ghost" size="icon"
                data-text-settings={drawing.id} aria-label={drawingSettingsLabel(drawing)}
                onClick={() => openDrawingStyle(drawing.id)}><Settings2 className="h-4 w-4" aria-hidden="true" /></Button>
              <Button type="button" data-text-delete={drawing.id} disabled={drawingBusy} variant="ghost" size="icon" aria-label={drawingDeleteLabel(drawing)} className="text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => void deleteDrawing(drawing.id)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </div>) : <p className="p-3 text-xs text-slate-500">{copy.marketReplay.drawingObjectsEmpty}</p>}
          </div>
          {drawingBusy ? <p role="status" className="border-t px-3 py-2 text-xs text-slate-500">{copy.marketReplay.drawingSaving}</p> : null}
          {!drawingsLoaded && !drawingBusy ? <Button type="button" variant="outline" className="m-3" onClick={() => void drawingState.refresh()}>{copy.marketReplay.drawingRetry}</Button> : null}
        </aside> : null}
      </div>
      </div>
    </div>

      {textDrawing.editor ? <TextSettingsDialog key={textDrawing.editor.key} editor={textDrawing.editor}
        apiRef={textDrawing.apiRef}
        onAdopt={textDrawing.adopt} register={textDrawing.register} isCurrent={textDrawing.guard()}
        templates={textTemplates} onTemplatesChange={setTextTemplates} onPreview={textDrawing.preview} onClose={textDrawing.close}
        onRemove={async (id, current) => {
          await drawingState.removeText(id, current); setSelectedDrawingId(value => value === id ? null : value);
        }}
        onSave={async (id, draft, clientId, current) => {
          const saved = await drawingState.saveText(id, draft, clientId, current);
          if (!current()) throw new Error(copy.marketReplay.textAutosaveError);
          setSelectedDrawingId(saved.id); setDefaultTextStyle({ ...saved.style }); return saved;
        }} /> : null}

    {(() => {
      const drawing = drawings.find(d => d.id === arrowStyleId);
      return drawing && isArrowDrawing(drawing) ? <ArrowSettingsDialog key={drawing.id} drawing={drawing}
        templates={arrowPreferences[drawing.type].templates}
        onTemplatesChange={templates => setArrowPreferences(current => ({ ...current, [drawing.type]: { ...current[drawing.type], templates } }))}
        onClose={() => setArrowStyleId(null)} onSave={async style => {
          if (!await drawingState.update(drawing.id, { style })) return false;
          setArrowPreferences(current => ({ ...current, [drawing.type]: { ...current[drawing.type], defaultStyle: { ...style } } }));
          return true;
        }} /> : null;
    })()}
    {(() => {
      const drawing = drawings.find(d => d.id === rectangleStyleId);
      return drawing?.type === DRAWING_TYPE_RECTANGLE ? <RectangleSettingsDialog key={drawing.id} drawing={drawing} templates={rectangleTemplates}
        onTemplatesChange={setRectangleTemplates} onClose={() => setRectangleStyleId(null)} onSave={style => saveRectangleStyle(drawing.id, style)} /> : null;
    })()}
    {(() => {
      const drawing = drawings.find(item => item.id === styleDrawingId);
      if (drawing?.type === "AB_CD" && styleDraft && "levels" in styleDraft) return <AbcdSettingsDialog key={drawing.id}
        draft={styleDraft} onDraftChange={setStyleDraft} templates={abcdPreferences.templates}
        onTemplatesChange={templates => setAbcdPreferences(current => ({ ...current, templates }))}
        onClose={() => { setStyleDrawingId(null); setStyleDraft(null); }}
        onSave={async style => {
          if (!await drawingState.update(drawing.id, { style })) return false;
          setAbcdPreferences(current => ({ ...current, defaultStyle: style }));
          return true;
        }} />;
      return drawing && !isArrowDrawing(drawing) && drawing.type !== "AB_CD" && drawing.type !== DRAWING_TYPE_RECTANGLE && drawing.type !== DRAWING_TYPE_TEXT && styleDraft ? <LineSettingsDialog key={drawing.id}
        drawing={drawing} draft={styleDraft} onDraftChange={setStyleDraft}
        templates={drawing.type === DRAWING_TYPE_FIB_RETRACEMENT ? fibonacciTemplates : trendLineTemplates}
        onTemplatesChange={templates => {
          if (drawing.type === DRAWING_TYPE_FIB_RETRACEMENT) setFibonacciTemplates(templates as typeof fibonacciTemplates);
          else setTrendLineTemplates(templates as typeof trendLineTemplates);
        }} onClose={() => { setStyleDrawingId(null); setStyleDraft(null); }}
        onSave={async style => {
          if (!await drawingState.update(drawing.id, { style })) return false;
          if (drawing.type === DRAWING_TYPE_FIB_RETRACEMENT) setDefaultFibonacciStyle(cloneLineDrawingStyle(style) as FibonacciRetracementStyle);
          else if ("color" in style) setDefaultTrendLineStyle({ ...style });
          return true;
        }} /> : null;
    })()}
    <Dialog open={settingsDialog === "candlesticks"} title={copy.marketReplay.candlestickSettings} description={copy.marketReplay.candlestickSettingsDescription} className="max-w-md" onClose={() => { setCandlestickStyleDraft(null); setSettingsDialog(null); }}>
      {candlestickStyleDraft ? <div className="space-y-5">
        <div className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 px-1 text-center text-xs font-medium text-slate-500"><span /><span>{copy.marketReplay.bullishCandle}</span><span>{copy.marketReplay.bearishCandle}</span></div>
        <div className="space-y-2">{([
          { visible: "bodyVisible", up: "upColor", down: "downColor", label: copy.marketReplay.candleBody },
          { visible: "borderVisible", up: "borderUpColor", down: "borderDownColor", label: copy.marketReplay.candleBorder },
          { visible: "wickVisible", up: "wickUpColor", down: "wickDownColor", label: copy.marketReplay.candleWick },
        ] as const).map((row) => <div key={row.visible} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 rounded-md border px-3 py-2.5">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={candlestickStyleDraft[row.visible]} onChange={(event) => setCandlestickStyleDraft((current) => current ? { ...current, [row.visible]: event.target.checked } : current)} className="h-4 w-4 rounded border-slate-300" />{row.label}</label>
          <Input type="color" value={candlestickStyleDraft[row.up]} aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bullishCandle)} onChange={(event) => setCandlestickStyleDraft((current) => current ? { ...current, [row.up]: event.target.value.toUpperCase() } : current)} className="mx-auto h-9 w-12 cursor-pointer p-1" />
          <Input type="color" value={candlestickStyleDraft[row.down]} aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bearishCandle)} onChange={(event) => setCandlestickStyleDraft((current) => current ? { ...current, [row.down]: event.target.value.toUpperCase() } : current)} className="mx-auto h-9 w-12 cursor-pointer p-1" />
        </div>)}</div>
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => { setCandlestickStyleDraft(null); setSettingsDialog(null); }}>{copy.marketReplay.drawingCancel}</Button><Button type="button" onClick={() => { setCandlestickStyle({ ...candlestickStyleDraft }); setCandlestickStyleDraft(null); setSettingsDialog(null); }}>{copy.marketReplay.drawingConfirm}</Button></div>
      </div> : null}
    </Dialog>

    <IndicatorSettingsDialog
      open={settingsDialog === "indicators"}
      onClose={() => setSettingsDialog(null)}
      volumeVisible={volumeVisible}
      onVolumeVisibleChange={setVolumeVisible}
      barCountConfig={barCountConfig}
      setBarCountConfig={setBarCountConfig}
      onBarCountRecentTradingDaysChange={updateBarCountRecentTradingDays}
      onBarCountIntervalChange={updateBarCountInterval}
      barCountError={indicatorError}
      abrEnabled={abrEnabled}
      onAbrEnabledChange={setAbrEnabled}
      abrLength={abrLength}
      onAbrLengthChange={updateAbrLength}
      abrError={indicatorError}
      emaEnabled={emaEnabled}
      onEmaEnabledChange={setEmaEnabled}
      emaIndicators={emaIndicators}
      setEmaIndicators={setEmaIndicators}
      onEmaLengthChange={updateEmaLength}
      onAddEma={addEma}
      emaError={indicatorError}
    />
  </>;
}
