"use client";


import { UserEntry } from "@/components/user-growth/user-entry";
import { useWebFullscreen } from "./use-web-fullscreen";
import { isHistoricalPlaybackBarReady } from "@/lib/market-replay/historical-playback";
import { useHistoricalPlayback } from "./use-historical-playback";
import { HistoricalPlaybackBar } from "./historical-playback-bar";
import { useReplayShortcuts } from "./use-replay-shortcuts";
import { isReplayPlaybackShortcut } from "@/lib/market-replay/keyboard-shortcuts";
import type { ChartHideAfter } from "@/lib/market-replay/chart-hide-after";
import { ArrowSettingsDialog } from "./arrow-controls";
import { useArrowPreferences } from "./use-arrow-preferences";
import { useAbcdPreferences } from "./use-abcd-preferences";
import { isArrowDrawing } from "@/lib/market-replay/chart-drawings";
import { ReplayDrawingPaneProvider, useReplayFetch, useReplaySession } from "./replay-session-context";
import { ReplayLayoutMenu, ReplayPaneDivider, ReplayPaneFrame, useReplayPaneLayout } from "./replay-pane-layout";
import { ReplaySecondaryPane, type PaneControl } from "./replay-secondary-pane";
import { useReplayPanePeriods } from "./use-replay-pane-periods";
import { createPaneReader } from "./use-replay-pane-bars";
import type { HistoricalPanePreparation } from "./use-historical-pane-window";
import { useDrawingScopeGuard } from "./use-drawing-scope-guard";
import type { ReplayViewportApi, ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";
import type { LayoutId, PaneId } from "@/lib/market-replay/multi-pane-layout";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Loader2, ChartCandlestick, Settings2, Trash2, X } from "lucide-react";
import { ReplayDrawingToolbar } from "./replay-drawing-toolbar";
import { useReplayCursorPreference } from "./use-replay-cursor-preference";
import type { ReplayCursorMode } from "@/lib/market-replay/cursor-mode";
import { ReplayChart, type ReplayVisibleSequenceRange } from "@/components/market-replay/replay-chart";
import { ChartStyleSettingsDialog } from "./chart-style-settings-dialog";
import { IndicatorSettingsDialog } from "@/components/market-replay/indicator-settings-dialog";
import { ChartVisibilityMenu } from "@/components/market-replay/chart-visibility-menu";
import { DisplaySessionControls } from "./display-session-controls";
import { DisplayIntervalControls } from "@/components/market-replay/display-interval-controls";
import { useReplayPreferences } from "@/components/market-replay/use-replay-preferences";
import { useHistoricalDrawings } from "./use-historical-drawings";
import { useDrawingStyleShortcuts } from "./use-drawing-style-shortcuts";
import { useDrawingCommands } from "./use-drawing-commands";
import { RectangleSettingsDialog } from "./rectangle-controls";
import { AbcdSettingsDialog } from "./abcd-settings-dialog";
import { LineSettingsDialog, cloneLineDrawingStyle, type LineDrawingStyle } from "./line-settings-dialog";
import { hasVisibleReplayDialog, isReplayShortcutInputTarget, replayDrawingShortcutKey } from "@/lib/market-replay/keyboard-shortcuts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { TextSettingsDialog } from "./text-settings-dialog";
import { useTextDrawingEditor } from "./use-text-drawing-editor";
import { drawingObjectName, drawingSettingsLabel, drawingDeleteLabel } from "@/lib/market-replay/drawing-presentation";
import { isValidBarCountInterval, isValidBarCountRecentTradingDays } from "@/lib/market-replay/bar-count";
import { cloneChartDisplay, type ChartDisplayConfig } from "@/lib/market-replay/chart-display";
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
import { historicalWindowFocusSequence, mergeHistoricalBars, readHistoricalResetWindow, readLaterHistoryWindow, boundedHistoricalPlaybackWindow, commitHistoricalWindowChange } from "@/lib/market-replay/historical-window";
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
  formatInterval,
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

type HistoricalPaneFocus = { sequence: number; revision: number; prepared?: HistoricalPanePreparation; resetView?: boolean };
type WindowChange = (signal: AbortSignal) => Promise<() => void>;

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
  const [webFullscreen, setWebFullscreen] = useState(false);
  const shortcuts = useReplayShortcuts();
  const [cursorMode, setCursorMode] = useReplayCursorPreference();
  const fetch = useReplayFetch();
  const replaySession = useReplaySession();
  const layout = useReplayPaneLayout(false, "historical-replay-pane-layout-v1");
  const { activePane } = layout;
  const [paneToolbar, setPaneToolbar] = useState<HTMLDivElement | null>(null);
  const [paneControls, setPaneControls] = useState<HTMLDivElement | null>(null);
  const paneControllers = useRef(new Map<PaneId, PaneControl>());
  const registerPane = useCallback((pane: PaneId, control: PaneControl | null) => {
    if (control) paneControllers.current.set(pane, control);
    else paneControllers.current.delete(pane);
  }, []);
  const paneReader = useMemo(createPaneReader, []);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const layoutTransition = useRef(false);
  const primaryViewportApi = useRef<ReplayViewportApi | null>(null);
  const primaryViewport = useRef<ReplayViewportSnapshot | null>(null);
  const beforeMaximize = useRef<ReplayViewportSnapshot | null>(null);
  const [primaryRevision, setPrimaryRevision] = useState(0);
  const [viewportResetRevision, setViewportResetRevision] = useState(0);
  const [displaySession, setDisplaySession] = useState(session.displaySession);
  const displayedSessionRef = useRef(session.displaySession);
  const [displayIntervalSeconds, setDisplayIntervalSeconds] = useState(session.displayIntervalSeconds);
  const [secondaryFocus, setSecondaryFocus] = useState<HistoricalPaneFocus>({ sequence: focusSequence, revision: 0 });
  const [paneFocus, setPaneFocus] = useState<Partial<Record<PaneId, HistoricalPaneFocus>>>({});
  const focusRevision = useRef(0);
  const displayedIntervalRef = useRef(session.displayIntervalSeconds);
  const mainWindowAbortRef = useRef<AbortController | null>(null);
  const visibleRangeRef = useRef<ReplayVisibleSequenceRange | null>(null);
  const [bars, setBars] = useState<AggregatedMarketBarData[]>([]);
  const [chartFocusSequence, setChartFocusSequence] = useState<number | null>(focusSequence);
  const [warmupBars, setWarmupBars] = useState<AggregatedMarketBarData[]>([]);
  const [annotations, setAnnotations] = useState<ReplayTradeAnnotationData[]>([]);
  const [loading, setLoading] = useState(true);
  const { periods, periodsForPrimary, setPeriod, mounted } = useReplayPanePeriods("historical-replay-pane-periods-v1:" + dataset.id,
    dataset.sourceIntervalSeconds, displayIntervalSeconds, layout.panes, !loading);
  const [error, setError] = useState<string | null>(null);
  const [measurementArmed, setMeasurementArmed] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null);
  const [drawingObjectsOpen, setDrawingObjectsOpen] = useState(false);
  const drawingWriteScope = dataset.id + ":" + replaySession?.id + ":" + replaySession?.activeProjectionId;
  const drawingScopeGuard = useDrawingScopeGuard(drawingWriteScope);
  const drawingState = useHistoricalDrawings({ datasetId: dataset.id, fetch, writeScope: drawingWriteScope });
  const { drawings, loaded: drawingsLoaded, busy: drawingBusy, error: drawingError } = drawingState;
  const [rectangleStyleId, setRectangleStyleId] = useState<string | null>(null);
  const [arrowStyleId, setArrowStyleId] = useState<string | null>(null);
  const { arrowPreferences, setArrowPreferences } = useArrowPreferences();
  const { abcdPreferences, setAbcdPreferences } = useAbcdPreferences();
  const [styleDrawingId, setStyleDrawingId] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState<LineDrawingStyle | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"candlesticks" | "indicators" | null>(null);
  const [chartStyleDraft, setChartStyleDraft] = useState<ChartDisplayConfig | null>(null);
  const [indicatorError, setIndicatorError] = useState<string | null>(null);
  const annotationAbortRef = useRef<AbortController | null>(null);
  const initialLoadCompletedRef = useRef(false);
  const windowAbortRef = useRef<AbortController | null>(null);
  const windowBusyRef = useRef(false);
  const exhaustedEdgesRef = useRef({ left: false, right: false });
  const [windowLoading, setWindowLoading] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);
  const {
    chartStyle, setChartStyle,
    emaEnabled,
    setEmaEnabled,
    emaIndicators,
    setEmaIndicators,
    abrEnabled,
    setAbrEnabled,
    abrLength,
    setAbrLength,
    gridVisible,
    candleCountdownEnabled, setCandleCountdownEnabled,
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
    drawingWriteScope, chartVisibility.drawings, drawings, defaultTextStyle);
  const { open: openTextDrawing } = textDrawing;
  const { beforeExit: finishText, discard: discardText, requestSettings: requestTextSettings } = textDrawing;
  const drawingCommandsDisabled = !chartVisibility.drawings || !drawingsLoaded || drawingBusy || measurementArmed || Boolean(textDrawing.editor)
    || Boolean(settingsDialog) || Boolean(drawingTool) || Boolean(rectangleStyleId) || Boolean(styleDrawingId) || Boolean(arrowStyleId);
  const drawingCommands = useDrawingCommands({ datasetId: dataset.id, scope: drawingWriteScope, active: activePane === 1,
    fetch, drawings, selectedDrawingId, setDrawings: drawingState.setDrawings, select: setSelectedDrawingId, disabled: drawingCommandsDisabled, editor: textDrawing.editor, chartApi: textDrawing.apiRef,
    displayKey: `${displayIntervalSeconds}:${displaySession}`, onNudgeError: drawingState.setError });
  useDrawingStyleShortcuts({ drawings, selectedDrawingId, drawingTool, active: activePane === 1, scope: drawingWriteScope,
    disabled: drawingCommandsDisabled || drawingCommands.pasteUnconfirmed || drawingCommands.pending,
    templates: { TREND_LINE: trendLineTemplates, FIB_RETRACEMENT: fibonacciTemplates, RECTANGLE: rectangleTemplates,
      TEXT: textTemplates, AB_CD: abcdPreferences.templates, ARROW_UP: arrowPreferences.ARROW_UP.templates, ARROW_DOWN: arrowPreferences.ARROW_DOWN.templates },
    apply: (id, style, action) => drawingState.update(id, { style }, action),
  });
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
  const playback = useHistoricalPlayback({ endSequence: session.endSequence, seconds: displayIntervalSeconds,
    disabled: windowLoading,
    getTimeline: () => ({ bars, seconds: displayIntervalSeconds, session: displaySession }),
    readLater: async (after, signal) => {
      const data = await readLaterHistoryWindow({ afterSequence: after, endSequence: session.endSequence,
        sourceSeconds: dataset.sourceIntervalSeconds ?? displayIntervalSeconds, displaySeconds: displayIntervalSeconds,
        visibleCount: VISIBLE_BAR_COUNT, shouldContinue: () => !signal.aborted,
        acceptBar: bar => isHistoricalPlaybackBarReady(bar, session.endSequence),
        readWindow: async focus => {
          const params = new URLSearchParams({ displayIntervalSeconds: String(displayIntervalSeconds), displaySession: displaySession,
            endSequence: String(session.endSequence), focusSequence: String(focus), visibleCount: String(VISIBLE_BAR_COUNT),
            warmupCount: String(Math.min(EMA_LENGTH_MAX, indicatorWarmupCount)) });
          const response = await fetch("/api/market-datasets/" + dataset.id + "/bars/window?" + params, { signal });
          const payload = await response.json() as WindowPayload & { error?: string };
          if (!response.ok) throw new Error(payload.error);
          return payload;
        },
      });
      if (signal.aborted || !data) return [];
      const window = boundedHistoricalPlaybackWindow(bars, data.visibleBars, Math.min(EMA_LENGTH_MAX, indicatorWarmupCount), warmupBars);
      setBars(window.visibleBars);
      if (window.warmupBars) setWarmupBars(window.warmupBars);
      return data.visibleBars;
    },
  });
  const playbackEngine = playback.engine;
  const resetChartViewDisabledReason = windowLoading || playback.busy ? copy.marketReplay.loading
    : layoutBusy ? copy.marketReplay.quickIntervalApplying : undefined;
  useWebFullscreen(webFullscreen, () => setWebFullscreen(false), () => activePane === 1
    ? Boolean(drawingTool || selectedDrawingId || measurementArmed) : Boolean(paneControllers.current.get(activePane)?.hasInteraction()));
  function startHistoricalPlayback(target: ChartHideAfter) {
    if (windowBusyRef.current || layoutTransition.current) return;
    playbackEngine.pause();
    const sequence = target.bar.lastSequence;
    const startPlayback = () => {
      setChartFocusSequence(sequence);
      setSecondaryFocus({ sequence, revision: ++focusRevision.current });
      setPaneFocus({});
      playbackEngine.start(target);
    };
    // A secondary pane can start playback outside the primary pane's loaded page.
    if (!bars.length || sequence < bars[0].firstSequence || sequence > bars.at(-1)!.lastSequence) {
      void loadHistoryWindow(displayIntervalSeconds, sequence, { onApply: startPlayback });
    } else {
      setWindowError(null);
      startPlayback();
    }
  }

  function exitHistoricalPlayback() {
    mainWindowAbortRef.current?.abort();
    mainWindowAbortRef.current = null;
    windowAbortRef.current?.abort();
    windowBusyRef.current = false;
    setWindowLoading(false);
    setWindowError(null);
    setChartFocusSequence(null);
    playbackEngine.exit();
  }
  useEffect(() => {
    if (!playback.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isReplayShortcutInputTarget(event.target) || hasVisibleReplayDialog() || textDrawing.editor
        || document.querySelector("[role='menu'], [role='listbox'], [data-context-menu]")) return;
      if (isReplayPlaybackShortcut(event, "ArrowDown", shortcuts.platform)) {
        event.preventDefault();
        if (!event.repeat && !windowLoading) playbackEngine.toggle();
      } else if (isReplayPlaybackShortcut(event, "ArrowRight", shortcuts.platform)) {
        event.preventDefault();
        if (!playback.playing && !windowLoading) void playbackEngine.step();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playback.active, playback.playing, playbackEngine, shortcuts.platform, textDrawing.editor, windowLoading]);
  const extendHistoryWindow = useCallback(async (range: ReplayVisibleSequenceRange) => {
    if (windowBusyRef.current || !bars.length || playback.busy) return;
    const first = bars[0];
    const last = bars[bars.length - 1];
    const nearRight = bars.findIndex((bar) => bar.lastSequence >= range.toSequence) >= bars.length - 100;
    const direction = range.barsBefore < 100 && !exhaustedEdgesRef.current.left && first.firstSequence > session.startSequence
      ? "left" : !playback.active && nearRight && !exhaustedEdgesRef.current.right && last.lastSequence < session.endSequence ? "right" : null;
    if (!direction) return;
    const controller = new AbortController();
    windowAbortRef.current = controller;
    windowBusyRef.current = true;
    setWindowLoading(true);
    setWindowError(null);
    const params = new URLSearchParams({
      displayIntervalSeconds: String(displayIntervalSeconds),
      displaySession: displaySession,
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
      const data = direction === "right" ? await readLaterHistoryWindow({ afterSequence: last.lastSequence,
        endSequence: session.endSequence, sourceSeconds: dataset.sourceIntervalSeconds ?? displayIntervalSeconds,
        displaySeconds: displayIntervalSeconds, visibleCount: VISIBLE_BAR_COUNT,
        shouldContinue: () => !controller.signal.aborted,
        readWindow: focus => { params.set("focusSequence", String(focus)); return readWindow(); },
      }) : await readWindow();
      if (!data) { exhaustedEdgesRef.current[direction] = true; return; }
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
  }, [bars, dataset.id, displayIntervalSeconds, indicatorWarmupCount, displaySession, session.endSequence, session.startSequence, fetch, playback.active, playback.busy, dataset.sourceIntervalSeconds]);

  const handleVisibleSequenceRange = useCallback((range: ReplayVisibleSequenceRange) => {
    visibleRangeRef.current = range;
    void extendHistoryWindow(range);
  }, [extendHistoryWindow]);

  const barCountRthSession = useMemo(() => resolveDisplaySession(dataset, "RTH"), [dataset]);
  const barCountSession = useMemo(
    () => resolveDisplaySession(dataset, displaySession) ?? datasetSession(dataset),
    [dataset, displaySession],
  );
  const paneChart = {
    dataset, drawingWriteScope, drawingScopeGuard, displayUtcOffsetMinutes, chartMarketSession: barCountSession, barCountRthSession,
    defaultTextStyle, setDefaultTextStyle, textTemplates, setTextTemplates,
    defaultTrendLineStyle, setDefaultTrendLineStyle, trendLineTemplates, setTrendLineTemplates,
    defaultFibonacciStyle, setDefaultFibonacciStyle, fibonacciTemplates, setFibonacciTemplates,
    defaultRectangleStyle, setDefaultRectangleStyle, rectangleTemplates, setRectangleTemplates,
    abcdPreferences, setAbcdPreferences, arrowPreferences, setArrowPreferences,
  };

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

  const runWindowChange = useCallback(async (prepare: WindowChange, isCurrent?: () => boolean) => {
    mainWindowAbortRef.current?.abort();
    windowAbortRef.current?.abort();
    windowBusyRef.current = true;
    const controller = new AbortController();
    mainWindowAbortRef.current = controller;
    const initial = !initialLoadCompletedRef.current;
    if (initial) setLoading(true);
    else setWindowLoading(true);
    setWindowError(null);
    try {
      return await commitHistoricalWindowChange(controller.signal, prepare, isCurrent);
    } catch (cause) {
      if (!controller.signal.aborted && isCurrent?.() !== false) {
        const message = cause instanceof Error && cause.message ? cause.message : copy.paperTrading.historicalReplayLoadFailed;
        if (initial) setError(message);
        else setWindowError(message);
      }
      return false;
    } finally {
      controller.abort();
      if (mainWindowAbortRef.current === controller) {
        mainWindowAbortRef.current = null;
        windowBusyRef.current = false;
        initialLoadCompletedRef.current = true;
        setLoading(false);
        setWindowLoading(false);
      }
    }
  }, []);

  const loadHistoryWindow = useCallback((seconds: number, targetSequence: number, options?: {
    session?: DisplaySession; preparePanes?: WindowChange; onApply?: () => void; resetView?: () => boolean;
  }) => runWindowChange(async signal => {
    const nextSession = options?.session ?? displayedSessionRef.current;
    const readPrimary = async (cutoff: number, focus: number | null) => {
      const params = new URLSearchParams({
        displayIntervalSeconds: String(seconds), displaySession: nextSession,
        endSequence: String(cutoff), visibleCount: String(VISIBLE_BAR_COUNT),
        warmupCount: String(Math.min(EMA_LENGTH_MAX, indicatorWarmupCount)),
      });
      if (focus !== null) params.set("focusSequence", String(focus));
      const response = await fetch("/api/market-datasets/" + dataset.id + "/bars/window?" + params, { signal });
      const data = await response.json() as WindowPayload & { error?: string };
      if (!response.ok) throw new Error(data.error);
      return data;
    };
    const [data, applyPanes] = await Promise.all([
      options?.resetView ? readHistoricalResetWindow(targetSequence, session.endSequence, VISIBLE_BAR_COUNT, signal, readPrimary)
        : readPrimary(session.endSequence, targetSequence),
      options?.preparePanes?.(signal),
    ]);
    return () => {
      exhaustedEdgesRef.current = { left: false, right: false };
      setChartFocusSequence(initialLoadCompletedRef.current ? null : targetSequence);
      displayedIntervalRef.current = seconds;
      displayedSessionRef.current = nextSession;
      setDisplaySession(nextSession);
      setDisplayIntervalSeconds(seconds);
      setBars(data.visibleBars);
      setWarmupBars(data.warmupBars);
      if (options?.resetView) setViewportResetRevision(revision => revision + 1);
      else playbackEngine.timelineChanged();
      applyPanes?.();
      options?.onApply?.();
    };
  }, options?.resetView), [dataset.id, indicatorWarmupCount, session.endSequence, fetch, playbackEngine, runWindowChange]);

  function resetPrimaryChartView(isCurrent: () => boolean) {
    if (mainWindowAbortRef.current || layoutTransition.current) return true;
    const boundary = playbackEngine.getSnapshot().boundary?.bar.lastSequence;
    const target = boundary ?? session.endSequence;
    if ((bars[0]?.lastSequence ?? Infinity) <= target && (bars.at(-1)?.lastSequence ?? -1) >= target) return false;
    if (playbackEngine.getSnapshot().busy) return false;
    void loadHistoryWindow(displayIntervalSeconds, target, { resetView: () => isCurrent()
      && target === (playbackEngine.getSnapshot().boundary?.bar.lastSequence ?? session.endSequence) });
    return true;
  }

  useEffect(() => {
    playbackEngine.pause();
    const target = playbackEngine.getSnapshot().boundary?.bar.lastSequence
      ?? historicalWindowFocusSequence(visibleRangeRef.current, focusSequence, session.startSequence, session.endSequence);
    void loadHistoryWindow(displayedIntervalRef.current, target);
    return () => mainWindowAbortRef.current?.abort();
  }, [focusSequence, loadHistoryWindow, session.endSequence, session.startSequence, playbackEngine]);

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
      if (!key || hasVisibleReplayDialog() || event.repeat || layoutBusy || settingsDialog || rectangleStyleId || styleDrawingId || textDrawing.editor || isReplayShortcutInputTarget(event.target)) return;
      if (activePane === 1 && (drawingBusy || !drawingsLoaded)) return;
      event.preventDefault();
      if (activePane === 1) void armDrawing(key);
      else void paneControllers.current.get(activePane)?.armDrawing(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePane, armDrawing, layoutBusy, settingsDialog, rectangleStyleId, styleDrawingId, textDrawing.editor, drawingBusy, drawingsLoaded]);

  async function changeWorkspace(action: () => boolean | void | Promise<boolean | void>) {
    if (windowBusyRef.current || layoutTransition.current || drawingCommands.pasteUnconfirmed || drawingCommands.pending && !drawingCommands.nudging
      || settingsDialog || rectangleStyleId || arrowStyleId || styleDrawingId) return false;
    layoutTransition.current = true;
    setLayoutBusy(true);
    try {
      if (!await finishText() || !await drawingCommands.flushNudges() || drawingBusy && !textDrawing.editor) return false;
      for (const controller of paneControllers.current.values()) if (!await controller.prepare()) return false;
      const sequence = playback.boundary?.bar.lastSequence ?? bars.at(-1)?.lastSequence ?? focusSequence;
      primaryViewport.current = primaryViewportApi.current?.capture(sequence, playback.active) ?? primaryViewport.current;
      setDrawingTool(null);
      setMeasurementArmed(false);
      return (await action()) !== false;
    } finally {
      layoutTransition.current = false;
      setLayoutBusy(false);
    }
  }

  async function selectLayout(template: LayoutId) {
    await changeWorkspace(() => layout.select(template));
  }

  function togglePane(pane: PaneId) {
    void changeWorkspace(() => {
      if (layout.maximized === pane) {
        primaryViewport.current = beforeMaximize.current;
        setPrimaryRevision(current => current + 1);
        for (const controller of paneControllers.current.values()) controller.restore();
      } else {
        beforeMaximize.current = primaryViewport.current;
        for (const controller of paneControllers.current.values()) controller.capture();
      }
      layout.toggleMaximize(pane);
    });
  }

  function changeActivePeriod(seconds: number) {
    return changeWorkspace(() => {
      if (!dataset.sourceIntervalSeconds || !isValidDisplayInterval(dataset.sourceIntervalSeconds, seconds)) {
        setWindowError(copy.marketReplay.invalidDisplayInterval);
        return false;
      }
      if (periods[activePane - 1] === seconds) return true;
      playbackEngine.pause();
      const { active, boundary } = playbackEngine.getSnapshot();
      const cursor = boundary?.bar.lastSequence ?? null;
      const formingCursor = active ? cursor : null;
      if (activePane === 1) {
        const target = cursor ?? historicalWindowFocusSequence(visibleRangeRef.current, focusSequence, session.startSequence, session.endSequence);
        return loadHistoryWindow(seconds, target, { preparePanes: prepareVisiblePaneSettings(periodsForPrimary(seconds), displaySession, cursor, formingCursor) });
      }
      const controller = paneControllers.current.get(activePane);
      if (!controller?.loadHistory) return false;
      const loadHistory = controller.loadHistory;
      const focus = paneFocus[activePane] ?? secondaryFocus;
      const target = Math.min(session.endSequence, cursor ?? controller.inspect() ?? focus.sequence);
      return runWindowChange(async signal => {
        const prepared = await loadHistory({ period: seconds, session: displaySession, focus: target,
          formingCursor: seconds > displayIntervalSeconds ? formingCursor : null }, signal);
        return () => {
          focusPane(activePane, target, prepared);
          setPeriod(activePane, seconds);
        };
      });
    });
  }

  function focusPane(pane: PaneId, sequence: number, prepared: HistoricalPanePreparation, resetView = false) {
    const next = { sequence: Math.min(session.endSequence, sequence), revision: ++focusRevision.current, prepared, resetView };
    setPaneFocus(current => ({ ...current, [pane]: next }));
  }

  function resetSecondaryChartView(pane: PaneId, isCurrent: () => boolean) {
    const { active, boundary, busy } = playbackEngine.getSnapshot();
    if (mainWindowAbortRef.current || layoutTransition.current || busy) return;
    const loadHistory = paneControllers.current.get(pane)?.loadHistory;
    if (!loadHistory) return;
    const period = periods[pane - 1];
    const target = boundary?.bar.lastSequence ?? session.endSequence;
    void runWindowChange(async signal => {
      const prepared = await loadHistory({ period, session: displaySession, focus: target, resetView: true,
        formingCursor: active && period > displayIntervalSeconds ? target : null }, signal);
      return () => focusPane(pane, target, prepared, true);
    }, () => isCurrent() && target === (playbackEngine.getSnapshot().boundary?.bar.lastSequence ?? session.endSequence));
  }

  function prepareVisiblePaneSettings(nextPeriods: number[], nextSession: DisplaySession, cursor: number | null, formingCursor: number | null): WindowChange {
    const panes = [...paneControllers.current].filter(([pane]) => layout.panes.has(pane));
    return async signal => {
      const nextFocus: Partial<Record<PaneId, HistoricalPaneFocus>> = {};
      await Promise.all(panes.map(async ([pane, controller]) => {
        if (!controller.loadHistory) return;
        const period = nextPeriods[pane - 1];
        const paneFormingCursor = period > nextPeriods[0] ? formingCursor : null;
        const needsForming = paneFormingCursor !== null && periods[pane - 1] <= displayIntervalSeconds;
        if (nextSession === displaySession && period === periods[pane - 1] && !needsForming) return;
        const focus = paneFocus[pane] ?? secondaryFocus;
        const sequence = Math.min(session.endSequence, cursor ?? controller.inspect() ?? focus.sequence);
        const prepared = await controller.loadHistory({ period, session: nextSession, focus: sequence, formingCursor: paneFormingCursor }, signal);
        nextFocus[pane] = { sequence, revision: ++focusRevision.current, prepared };
      }));
      return () => setPaneFocus(current => ({ ...current, ...nextFocus }));
    };
  }

  function changeActiveSession(next: DisplaySession) {
    return changeWorkspace(() => {
      if (next === displaySession) return true;
      if (!dataset.availableDisplaySessions.includes(next) || !resolveDisplaySession(dataset, next)) {
        setWindowError(copy.marketReplay.unsupportedDisplaySession);
        return false;
      }
      playbackEngine.pause();
      const { active, boundary } = playbackEngine.getSnapshot();
      const cursor = boundary?.bar.lastSequence ?? null;
      const target = cursor ?? historicalWindowFocusSequence(visibleRangeRef.current, focusSequence, session.startSequence, session.endSequence);
      return loadHistoryWindow(displayIntervalSeconds, target, { session: next,
        preparePanes: prepareVisiblePaneSettings(periods, next, cursor, active ? cursor : null) });
    });
  }

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
    return <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500 dark:text-muted-foreground" aria-busy="true">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {copy.marketReplay.loading}
    </div>;
  }

  if (error) {
    return <div className="p-4">
      <Alert className="border-red-200 dark:border-negative/40 bg-red-50 dark:bg-negative-background" role="alert">
        <AlertTitle>{copy.common.error}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    </div>;
  }

  return <>
    <div data-web-fullscreen={webFullscreen} aria-label={dataset.name} className={webFullscreen
      ? "fixed inset-0 z-40 flex h-dvh min-h-0 flex-col overflow-hidden bg-white dark:bg-card"
      : "flex h-full min-h-0 flex-col"}>
      <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 [&>*]:shrink-0">
        {webFullscreen ? <span className="max-w-48 truncate text-xs font-medium" title={dataset.name}>{dataset.symbol} · {copy.paperTrading.historicalReplayReadOnly}</span> : null}
        <DisplayIntervalControls
          value={periods[activePane - 1]}
          sourceIntervalSeconds={dataset.sourceIntervalSeconds}
          disabled={windowLoading || layoutBusy}
          onChange={changeActivePeriod}
        />
        <DisplaySessionControls value={displaySession} available={dataset.availableDisplaySessions}
          disabled={windowLoading || layoutBusy} onChange={changeActiveSession} />
        {activePane === 1 ? <>
        <ChartVisibilityMenu value={chartVisibility} onChange={changeChartVisibility} />
        <Button type="button" variant={settingsDialog === "candlesticks" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => { setChartStyleDraft(cloneChartDisplay(chartStyle)); setSettingsDialog("candlesticks"); }}>
          <ChartCandlestick className="h-4 w-4" />{copy.marketReplay.chartStyle}
        </Button>
        <Button type="button" variant={settingsDialog === "indicators" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setSettingsDialog("indicators")}>
          <Settings2 className="h-4 w-4" />{copy.marketReplay.indicators}
        </Button>
        </> : <div ref={setPaneControls} className="flex items-center gap-2" />}
        <div className="ml-auto flex items-center gap-2">
          <ReplayLayoutMenu template={layout.template} disabled={windowLoading || layoutBusy} onSelect={selectLayout} onReset={layout.resetRatios} />
          {webFullscreen ? <UserEntry compact session={replaySession ?? undefined} /> : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {activePane === 1 ? <ReplayDrawingToolbar cursorMode={cursorMode} onCursorChange={mode => { if (!drawingCommands.pending && !drawingCommands.pasteUnconfirmed) void selectCursor(mode); }} drawingTool={drawingTool} drawingDisabled={!drawingsLoaded || drawingBusy || drawingCommands.pending || drawingCommands.pasteUnconfirmed || layoutBusy}
          history={drawingCommands} onArmDrawing={tool => void armDrawing(tool)} measurementArmed={measurementArmed}
          onToggleMeasurement={() => { if (!drawingCommands.pending && !drawingCommands.pasteUnconfirmed) { setDrawingTool(null); setMeasurementArmed(current => !current); } }}
          drawingObjectsOpen={drawingObjectsOpen} onToggleDrawingObjects={() => setDrawingObjectsOpen(current => !current)}
          webFullscreen={webFullscreen} onToggleWebFullscreen={() => setWebFullscreen(current => !current)} /> : <div ref={setPaneToolbar} className="flex shrink-0" />}
      <div ref={layout.setHost} className="relative min-h-0 min-w-0 flex-1" data-replay-pane-workspace aria-busy={windowLoading || drawingBusy}>
        {windowLoading ? <div className="absolute left-3 top-3 z-50 flex w-fit items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{copy.marketReplay.loading}</div> : null}
        {windowError ? <Alert className="absolute left-3 top-3 z-50 w-auto max-w-[calc(100%-1.5rem)] border-negative/40 bg-negative-background" role="alert"><AlertTitle>{copy.common.error}</AlertTitle><AlertDescription>{windowError}</AlertDescription></Alert> : null}
        {layout.measured && layout.panes.has(1) ? <ReplayPaneFrame pane={1} rect={layout.panes.get(1)!} active={activePane === 1}
          title={dataset.symbol + " · " + formatInterval(displayIntervalSeconds)} showHeader={layout.panes.size > 1 || layout.maximized === 1}
          maximized={layout.maximized === 1} canMaximize={!layoutBusy && !windowLoading && (layout.panes.size > 1 || layout.maximized === 1)}
          onActivate={() => layout.setActive(1)} onMaximize={() => togglePane(1)}>
        {drawingError ? <Alert className="absolute left-3 top-3 z-50 w-auto border-red-200 dark:border-negative/40 bg-red-50 dark:bg-negative-background" role="alert"><AlertTitle>{copy.marketReplay.drawingSyncErrorTitle}</AlertTitle><AlertDescription>{drawingError}</AlertDescription></Alert> : null}
        <ReplayChart
          key={primaryRevision}
          compact={layout.panes.size > 1 || Boolean(layout.maximized)}
          shortcutsActive={activePane === 1}
          onAltMaximize={!layoutBusy && !windowLoading && (layout.panes.size > 1 || layout.maximized === 1) ? () => togglePane(1) : undefined}
          viewportApiRef={primaryViewportApi}
          initialViewportSnapshot={primaryViewport.current}
          cursorMode={cursorMode}
          datasetId={dataset.id}
          priceTickSize={dataset.priceTickSize}
          bars={bars}
          warmupBars={warmupBars}
          displayUtcOffsetMinutes={displayUtcOffsetMinutes}
          displayIntervalSeconds={displayIntervalSeconds}
          sourceIntervalSeconds={dataset.sourceIntervalSeconds ?? undefined}
          candleCountdownEnabled={chartVisibility.indicators && candleCountdownEnabled && playback.countdownSeconds !== null}
          candleCountdownSeconds={playback.countdownSeconds}
          playbackActive={playback.playing && !playback.busy && !windowLoading}
          measurementArmed={measurementArmed}
          candlestickStyle={(chartStyleDraft ?? chartStyle).candlestickStyle}
          chartDisplay={chartStyleDraft ?? chartStyle}
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
          drawingNudgePreviews={drawingCommands.nudgePreviews}
          drawingEditingLocked={drawingCommands.nudging || layoutBusy}
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
          displaySession={displaySession}
          barCountSession={barCountSession}
          barCountRthSession={barCountRthSession}
          barCountConfig={visibleBarCountConfig}
          paperSnapshot={null}
          tradeAnnotations={annotations}
          tradeAnnotationsTruncated={false}
          tradeAnnotationsVisible={chartVisibility.tradeAnnotations}
          hiddenAfter={playback.boundary}
          onHiddenAfterChange={target => playbackEngine.hide(target)}
          historicalPlaybackActive={playback.active}
          onStartHistoricalPlayback={windowLoading ? undefined : startHistoricalPlayback}
          currentSourceSequence={playback.boundary?.bar.lastSequence}
          viewportResetRevision={viewportResetRevision}
          resetChartViewDisabledReason={resetChartViewDisabledReason}
          onResetChartView={resetPrimaryChartView}
          focusSequence={chartFocusSequence}
          onFocusApplied={() => setChartFocusSequence(null)}
          onVisibleSequenceRangeChange={range => {
            const sequence = playback.boundary?.bar.lastSequence ?? bars.at(-1)?.lastSequence ?? focusSequence;
            primaryViewport.current = primaryViewportApi.current?.capture(sequence, playback.active) ?? primaryViewport.current;
            handleVisibleSequenceRange(range);
          }}
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
        {drawingObjectsOpen ? <aside className="absolute right-3 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-lg border border-slate-200 dark:border-border bg-white/95 dark:bg-card/95 shadow-xl backdrop-blur">
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <ListTree className="h-4 w-4 text-slate-500 dark:text-muted-foreground" /><h3 className="text-sm font-semibold text-slate-950 dark:text-foreground">{copy.marketReplay.drawingObjects}</h3>
            <Button type="button" variant="ghost" size="sm" disabled={!drawingsLoaded || drawingBusy || drawingCommands.nudging || !drawings.length}
              data-text-delete="all" aria-label={copy.marketReplay.clearDrawings} className="ml-auto text-red-600 dark:text-negative hover:bg-red-50 dark:hover:bg-negative-background hover:text-red-700 dark:hover:text-negative"
              onClick={async () => { await discardText(); if (await drawingState.clear()) { setSelectedDrawingId(null); setRectangleStyleId(null); setStyleDrawingId(null); setStyleDraft(null); } }}>{copy.marketReplay.clearDrawingsShort}</Button>
            <button type="button" className="ml-auto rounded p-1 text-slate-400 dark:text-muted-foreground hover:bg-slate-100 dark:hover:bg-hover hover:text-slate-700 dark:hover:text-secondary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label={copy.marketReplay.closeDrawingObjects} onClick={() => setDrawingObjectsOpen(false)}><X className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {drawings.length ? drawings.map((drawing, index) => <div key={drawing.id} className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${selectedDrawingId === drawing.id ? "bg-blue-50 dark:bg-info-background text-blue-800 dark:text-link" : "text-slate-700 dark:text-secondary-text hover:bg-slate-100 dark:hover:bg-hover"}`}>
              <button type="button" data-drawing-nudge-id={drawing.id} aria-pressed={selectedDrawingId === drawing.id}
                className="min-w-0 flex-1 truncate text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={event => { event.currentTarget.focus({ preventScroll: true }); setSelectedDrawingId(drawing.id); }}
                onDoubleClick={() => { if (!drawingCommands.nudging) void openDrawingStyle(drawing.id); }}>
                {drawingObjectName(drawing, index + 1)}
              </button>
              <Button type="button" disabled={drawingBusy || drawingCommands.nudging} variant="ghost" size="icon"
                data-text-settings={drawing.id} aria-label={drawingSettingsLabel(drawing)}
                onClick={() => openDrawingStyle(drawing.id)}><Settings2 className="h-4 w-4" aria-hidden="true" /></Button>
              <Button type="button" data-text-delete={drawing.id} disabled={drawingBusy || drawingCommands.nudging} variant="ghost" size="icon" aria-label={drawingDeleteLabel(drawing)} className="text-slate-400 dark:text-muted-foreground hover:bg-red-50 dark:hover:bg-negative-background hover:text-red-600 dark:hover:text-negative" onClick={() => void deleteDrawing(drawing.id)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </div>) : <p className="p-3 text-xs text-slate-500 dark:text-muted-foreground">{copy.marketReplay.drawingObjectsEmpty}</p>}
          </div>
          {drawingBusy ? <p role="status" className="border-t px-3 py-2 text-xs text-slate-500 dark:text-muted-foreground">{copy.marketReplay.drawingSaving}</p> : null}
          {!drawingsLoaded && !drawingBusy ? <Button type="button" variant="outline" className="m-3" onClick={() => void drawingState.refresh()}>{copy.marketReplay.drawingRetry}</Button> : null}
        </aside> : null}
        </ReplayPaneFrame> : null}
        {layout.dividers.map(divider => <ReplayPaneDivider key={divider.key} divider={divider} onRatio={ratio => layout.changeRatio(divider.key, ratio)} />)}
        {mounted.map(pane => {
          const focus = paneFocus[pane] ?? secondaryFocus;
          return <ReplayDrawingPaneProvider key={pane} pane={pane}>
            <ReplaySecondaryPane pane={pane} core={paneChart} rect={layout.panes.get(pane)} active={activePane === pane}
              period={periods[pane - 1]} sequence={playback.boundary?.bar.lastSequence ?? session.endSequence} session={displaySession}
              cursorMode={cursorMode} onCursorChange={setCursorMode} controls={paneControls} toolbar={paneToolbar}
              register={registerPane} maximized={layout.maximized === pane} canMaximize={!layoutBusy && !windowLoading}
              onActivate={() => layout.setActive(pane)} onMaximize={() => togglePane(pane)} reader={paneReader}
              blocked={layoutBusy || Boolean(settingsDialog || rectangleStyleId || arrowStyleId || styleDrawingId)}
              webFullscreen={webFullscreen} toggleWebFullscreen={() => setWebFullscreen(current => !current)}
              historical={{ start: session.startSequence, end: session.endSequence, primaryPeriod: displayIntervalSeconds,
                focus: focus.sequence, focusRevision: focus.revision, prepared: focus.prepared, resetView: focus.resetView,
                annotations, boundary: playback.boundary, playbackActive: playback.active, playing: playback.playing && !playback.busy && !windowLoading,
                countdownSeconds: playback.countdownSeconds, onStart: windowLoading ? undefined : startHistoricalPlayback,
                onHide: playbackEngine.hide, resetViewDisabledReason: resetChartViewDisabledReason,
                onResetView: isCurrent => resetSecondaryChartView(pane, isCurrent) }} />
          </ReplayDrawingPaneProvider>;
        })}
      </div>
      </div>
      <HistoricalPlaybackBar playback={playback} seconds={displayIntervalSeconds} disabled={windowLoading}
        onToggle={playbackEngine.toggle} onNext={() => void playbackEngine.step()} onRate={playbackEngine.setRate} onExit={exitHistoricalPlayback} />
    </div>

      {textDrawing.editor ? <TextSettingsDialog key={textDrawing.editor.key} editor={textDrawing.editor}
        onHistoryGroup={drawingCommands.textGroup}
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
    <ChartStyleSettingsDialog
      open={settingsDialog === "candlesticks"}
      draft={chartStyleDraft}
      onDraftChange={setChartStyleDraft}
      onClose={() => { setChartStyleDraft(null); setSettingsDialog(null); }}
      onConfirm={style => {
        setChartStyle(style);
        setChartStyleDraft(null);
        setSettingsDialog(null);
      }}
    />

    <IndicatorSettingsDialog
      open={settingsDialog === "indicators"}
      candleCountdown={{ enabled: candleCountdownEnabled, onChange: setCandleCountdownEnabled, description: copy.marketReplay.historicalCandleCountdownDescription }}
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
