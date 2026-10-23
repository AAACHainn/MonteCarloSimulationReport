"use client";

import { useReplaySession } from "./replay-session-context";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type IChartApi, type IPriceLine, type ISeriesApi } from "lightweight-charts";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import { calculateChartMeasurement } from "@/lib/market-replay/chart-measurement";
import { DRAWING_TYPE_FIB_RETRACEMENT, DRAWING_TYPE_TREND_LINE, DRAWING_TYPE_RECTANGLE, DRAWING_TYPE_TEXT, type TextDrawing, type TextGeometry, type RectangleDrawing, type DrawingAnchor, type FibonacciRetracementDrawing, type TrendLineDrawing, type TrendLineGeometry } from "@/lib/market-replay/chart-drawings";
import { drawingTimelineBars, DrawingTimelineLocator } from "@/lib/market-replay/drawing-timeline";
import { RectanglePrimitive } from "@/lib/market-replay/rectangle-primitive";
import { TrendLinePrimitive } from "@/lib/market-replay/trend-line-primitive";
import { FibonacciRetracementPrimitive } from "@/lib/market-replay/fibonacci-retracement-primitive";
import { TextDrawingPrimitive, type TextEditPreview, type TextEditorPosition } from "@/lib/market-replay/text-drawing-primitive";
import { createTextClickBridge } from "./text-inline-editor-events";
import { ReplayTradeAnnotationPrimitive } from "@/lib/market-replay/trade-annotation-primitive";
import { BarCountPrimitive } from "@/lib/market-replay/bar-count-primitive";
import { CandleCountdownPrimitive } from "@/lib/market-replay/candle-countdown-primitive";
import { chartBarsBeforeHiddenBoundary, type ChartHideAfter } from "@/lib/market-replay/chart-hide-after";
import { DraftOrder, ContextMenuState, AbrTooltipState, LineTarget, LineAction, MeasurementState, DrawingDraft, DrawingSegmentCoordinate, sameLineActions } from "./replay-chart-shared";
import type { ReplayChartProps } from "./replay-chart-shared";

export function useReplayChartCore({
  datasetId, dataRevision = "", priceTickSize, bars, warmupBars, displayUtcOffsetMinutes, displayIntervalSeconds, measurementArmed,
  candlestickStyle, gridVisible = true, onToggleGrid,
  onMeasurementArmedChange, drawingTool, onDrawingToolChange, trendLineDraftStyle, fibonacciDraftStyle, rectangleDraftStyle, drawings, selectedDrawingId,
  onSelectedDrawingIdChange, onCreateDrawing, onUpdateDrawing, onDeleteDrawing, onPlaceText, drawingApiRef,
  onOpenDrawingStyle, emaEnabled, emaIndicators, abrEnabled, abrLength, volumeVisible,
  displaySession, barCountSession, barCountConfig, paperSnapshot,
  tradeAnnotations, tradeAnnotationsTruncated, focusSequence = null, onFocusApplied,
  tradeAnnotationsVisible = true,
  candleCountdownEnabled = false, playbackActive = false, currentSourceTimestamp = null, sourceIntervalSeconds,
  readOnly = false,
  paperBusy, paperError, onSubmitOrder, onOrderPriceChange,
  onCancelOrder, onClosePosition, onDraftActiveChange, onDraftIdentityChange, entryCheckOpen = false, onOpenPaperAccount, onVisibleSequenceRangeChange,
  onRewindToBar, rewindRange,
}: ReplayChartProps) {
  const replaySession = useReplaySession();
  const visibilityScope = `${datasetId}:${replaySession?.id ?? ""}:${paperSnapshot?.session.id ?? ""}:${readOnly}`;
  const [hiddenBoundary, setHiddenBoundary] = useState<{ scope: string; target: ChartHideAfter } | null>(null);
  const hiddenAfter = hiddenBoundary?.scope === visibilityScope ? hiddenBoundary.target : null;
  const visibleBars = useMemo(() => chartBarsBeforeHiddenBoundary(bars, hiddenAfter, displayIntervalSeconds, displaySession), [bars, hiddenAfter, displayIntervalSeconds, displaySession]);
  const visibleWarmupBars = useMemo(() => chartBarsBeforeHiddenBoundary(warmupBars, hiddenAfter, displayIntervalSeconds, displaySession), [warmupBars, hiddenAfter, displayIntervalSeconds, displaySession]);
  useEffect(() => { setHiddenBoundary(null); }, [visibilityScope]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<HTMLDivElement | null>(null);
  const orderTicketRef = useRef<HTMLDivElement | null>(null);
  const orderTicketDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef(new Map<string, IPriceLine>());
  const lineTargetsRef = useRef(new Map<string, LineTarget>());
  const tradeAnnotationPrimitiveRef = useRef<ReplayTradeAnnotationPrimitive | null>(null);
  const barCountPrimitiveRef = useRef<BarCountPrimitive | null>(null);
  const candleCountdownPrimitiveRef = useRef<CandleCountdownPrimitive | null>(null);
  const rectanglePrimitiveRef = useRef<RectanglePrimitive | null>(null);
  const trendLinePrimitiveRef = useRef<TrendLinePrimitive | null>(null);
  const fibonacciPrimitiveRef = useRef<FibonacciRetracementPrimitive | null>(null);
  const textPrimitiveRef = useRef<TextDrawingPrimitive | null>(null);
  const textEditRef = useRef<TextEditPreview | null>(null);
  const textClicks = useRef<ReturnType<typeof createTextClickBridge> | null>(null);
  textClicks.current ??= createTextClickBridge();
  const textPositionRef = useRef<{ anchor: DrawingAnchor; listener: (position: TextEditorPosition | null) => void } | null>(null);
  const textDragRef = useRef<{ id: string; geometry: TextGeometry } | null>(null);
  const onPlaceTextRef = useRef(onPlaceText); onPlaceTextRef.current = onPlaceText;
  const lastDataRef = useRef<AggregatedMarketBarData[]>([]);
  const lastDataRevisionRef = useRef(dataRevision);
  const lastHiddenAfterRef = useRef<ChartHideAfter | null>(null);
  const lastDataIntervalRef = useRef(displayIntervalSeconds);
  const lastDataSessionRef = useRef(displaySession);
  const displaySessionRef = useRef(displaySession);
  displaySessionRef.current = displaySession;
  const barsRef = useRef(visibleBars);
  const timelineBarsRef = useRef(bars);
  const projectionBars = useMemo(() => drawingTimelineBars(bars), [bars]);
  const projectionBarsRef = useRef(projectionBars);
  const drawingTimelineRef = useRef(new DrawingTimelineLocator());
  const drawingScopeRef = useRef(visibilityScope);
  const drawingFrameRef = useRef<number | null>(null);
  const drawingSessionRef = useRef(barCountSession);
  const requestedDrawingSessionRef = useRef(barCountSession);
  requestedDrawingSessionRef.current = barCountSession;
  const onVisibleSequenceRangeChangeRef = useRef(onVisibleSequenceRangeChange);
  onVisibleSequenceRangeChangeRef.current = onVisibleSequenceRangeChange;
  const onFocusAppliedRef = useRef(onFocusApplied);
  onFocusAppliedRef.current = onFocusApplied;
  const tradeAnnotationsRef = useRef(tradeAnnotations);
  tradeAnnotationsRef.current = tradeAnnotations;
  const tradeAnnotationsVisibleRef = useRef(tradeAnnotationsVisible);
  tradeAnnotationsVisibleRef.current = tradeAnnotationsVisible;
  const candlestickStyleRef = useRef(candlestickStyle);
  candlestickStyleRef.current = candlestickStyle;
  const priceTickSizeRef = useRef(priceTickSize);
  priceTickSizeRef.current = priceTickSize;
  const trendLineDraftStyleRef = useRef(trendLineDraftStyle);
  trendLineDraftStyleRef.current = trendLineDraftStyle;
  const rectangleDraftStyleRef = useRef(rectangleDraftStyle);
  rectangleDraftStyleRef.current = rectangleDraftStyle;
  const fibonacciDraftStyleRef = useRef(fibonacciDraftStyle);
  fibonacciDraftStyleRef.current = fibonacciDraftStyle;
  const measurementArmedRef = useRef(measurementArmed);
  const onMeasurementArmedChangeRef = useRef(onMeasurementArmedChange);
  const drawingToolRef = useRef(drawingTool);
  const drawingsRef = useRef(drawings);
  const drawingGroups = useMemo(() => {
    const trend: TrendLineDrawing[] = [], fibonacci: FibonacciRetracementDrawing[] = [], rectangle: RectangleDrawing[] = [], text: TextDrawing[] = [];
    for (const drawing of drawings) {
      if (drawing.type === DRAWING_TYPE_RECTANGLE) rectangle.push(drawing);
      else if (drawing.type === DRAWING_TYPE_TREND_LINE) trend.push(drawing);
      else if (drawing.type === DRAWING_TYPE_FIB_RETRACEMENT) fibonacci.push(drawing);
      else if (drawing.type === DRAWING_TYPE_TEXT) text.push(drawing);
    }
    return { trend, fibonacci, rectangle, text };
  }, [drawings]);
  const drawingGroupsRef = useRef(drawingGroups);
  drawingGroupsRef.current = drawingGroups;
  const selectedDrawingIdRef = useRef(selectedDrawingId);
  const onDrawingToolChangeRef = useRef(onDrawingToolChange);
  const onSelectedDrawingIdChangeRef = useRef(onSelectedDrawingIdChange);
  const onCreateDrawingRef = useRef(onCreateDrawing);
  const onUpdateDrawingRef = useRef(onUpdateDrawing);
  const onDeleteDrawingRef = useRef(onDeleteDrawing);
  const onOpenDrawingStyleRef = useRef(onOpenDrawingStyle);
  const displayIntervalSecondsRef = useRef(displayIntervalSeconds);
  const requestedDisplayIntervalSecondsRef = useRef(displayIntervalSeconds);
  requestedDisplayIntervalSecondsRef.current = displayIntervalSeconds;
  const sourceIntervalSecondsRef = useRef(sourceIntervalSeconds ?? displayIntervalSeconds);
  sourceIntervalSecondsRef.current = sourceIntervalSeconds ?? displayIntervalSeconds;
  const gridVisibleRef = useRef(gridVisible);
  gridVisibleRef.current = gridVisible;
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [abrTooltip, setAbrTooltip] = useState<AbrTooltipState | null>(null);
  const [measurement, setMeasurement] = useState<MeasurementState | null>(null);
  const measurementRef = useRef<MeasurementState | null>(null);
  const drawingDraftRef = useRef<DrawingDraft | null>(null);
  const drawingDraftCoordinateRef = useRef<DrawingSegmentCoordinate | null>(null);
  const drawingPreviewRef = useRef<{ id: string; geometry: TrendLineGeometry } | null>(null);
  const [draft, setDraft] = useState<DraftOrder | null>(null);
  const [orderTicketPosition, setOrderTicketPosition] = useState<{ x: number; y: number } | null>(null);
  const [defaultRiskAmount, setDefaultRiskAmount] = useState<number | null>(null);
  const [defaultTargetR, setDefaultTargetR] = useState(2);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [lineActions, setLineActions] = useState<LineAction[]>([]);
  const hasVolume = useMemo(() => [...warmupBars, ...bars].some((bar) => bar.volume !== null), [bars, warmupBars]);
  const warmupBarsRef = useRef(visibleWarmupBars);
  warmupBarsRef.current = visibleWarmupBars;
  const abrLengthRef = useRef(abrLength);
  abrLengthRef.current = abrLength;
  const latest = bars.at(-1);
  const currentPrice = latest?.close ?? null;
  const currentPriceRef = useRef(currentPrice);
  const displayUtcOffsetRef = useRef(displayUtcOffsetMinutes);
  const onOrderPriceChangeRef = useRef(onOrderPriceChange);
  const paperSessionId = paperSnapshot?.session.id ?? null;
  const paperInitialCapital = paperSnapshot?.session.initialCapital ?? null;
  const hasPendingClose = paperSnapshot?.activeOrders.some((order) => order.reduceOnly && !order.isProtective) ?? false;

  useEffect(() => { currentPriceRef.current = currentPrice; }, [currentPrice]);
  useEffect(() => { measurementArmedRef.current = measurementArmed; }, [measurementArmed]);
  useEffect(() => { onMeasurementArmedChangeRef.current = onMeasurementArmedChange; }, [onMeasurementArmedChange]);
  useEffect(() => { measurementRef.current = measurement; }, [measurement]);
  useEffect(() => { drawingToolRef.current = drawingTool; }, [drawingTool]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { selectedDrawingIdRef.current = selectedDrawingId; }, [selectedDrawingId]);
  useEffect(() => { onDrawingToolChangeRef.current = onDrawingToolChange; }, [onDrawingToolChange]);
  useEffect(() => { onSelectedDrawingIdChangeRef.current = onSelectedDrawingIdChange; }, [onSelectedDrawingIdChange]);
  useEffect(() => { onCreateDrawingRef.current = onCreateDrawing; }, [onCreateDrawing]);
  useEffect(() => { onUpdateDrawingRef.current = onUpdateDrawing; }, [onUpdateDrawing]);
  useEffect(() => { onDeleteDrawingRef.current = onDeleteDrawing; }, [onDeleteDrawing]);
  useEffect(() => { onOpenDrawingStyleRef.current = onOpenDrawingStyle; }, [onOpenDrawingStyle]);
  useEffect(() => { displayUtcOffsetRef.current = displayUtcOffsetMinutes; }, [displayUtcOffsetMinutes]);
  useEffect(() => { onOrderPriceChangeRef.current = onOrderPriceChange; }, [onOrderPriceChange]);

  const syncLineActionCoordinates = useCallback(() => {
    const series = candleRef.current;
    if (!series) return;
    setLineActions((current) => {
      const next = current.map((action) => {
        const coordinate = series.priceToCoordinate(action.price);
        return coordinate === null || Number(coordinate) === action.y
          ? action
          : { ...action, y: Number(coordinate) };
      });
      return sameLineActions(current, next) ? current : next;
    });
  }, []);

  const syncDrawingPrimitive = useCallback(() => {
    if (drawingFrameRef.current !== null) return;
    drawingFrameRef.current = requestAnimationFrame(() => {
      drawingFrameRef.current = null;
      const timeline = drawingTimelineRef.current;
      timeline.setTimeline(projectionBarsRef.current, displayIntervalSecondsRef.current, {
        sourceIntervalSeconds: sourceIntervalSecondsRef.current, session: drawingSessionRef.current,
      }, drawingScopeRef.current);
      trendLinePrimitiveRef.current?.setDrawings({
        drawings: drawingGroupsRef.current.trend,
        selectedDrawingId: selectedDrawingIdRef.current,
        preview: drawingPreviewRef.current,
        draft: drawingToolRef.current === DRAWING_TYPE_TREND_LINE ? drawingDraftRef.current : null,
        draftStyle: trendLineDraftStyleRef.current,
        bars: projectionBarsRef.current,
        timeline,
        displayIntervalSeconds: displayIntervalSecondsRef.current,
        sourceIntervalSeconds: sourceIntervalSecondsRef.current,
        session: drawingSessionRef.current,
        priceTickSize: priceTickSizeRef.current,
      });
      rectanglePrimitiveRef.current?.setDrawings({
        drawings: drawingGroupsRef.current.rectangle,
        selectedDrawingId: selectedDrawingIdRef.current,
        preview: drawingPreviewRef.current,
        draft: drawingToolRef.current === DRAWING_TYPE_RECTANGLE ? drawingDraftRef.current : null,
        draftStyle: rectangleDraftStyleRef.current,
        bars: projectionBarsRef.current, timeline,
        displayIntervalSeconds: displayIntervalSecondsRef.current,
        sourceIntervalSeconds: sourceIntervalSecondsRef.current, session: drawingSessionRef.current,
      });
      fibonacciPrimitiveRef.current?.setDrawings({
        drawings: drawingGroupsRef.current.fibonacci,
        selectedDrawingId: selectedDrawingIdRef.current,
        preview: drawingPreviewRef.current,
        draft: drawingToolRef.current === DRAWING_TYPE_FIB_RETRACEMENT ? drawingDraftRef.current : null,
        draftStyle: fibonacciDraftStyleRef.current,
        bars: projectionBarsRef.current,
        timeline,
        displayIntervalSeconds: displayIntervalSecondsRef.current,
        sourceIntervalSeconds: sourceIntervalSecondsRef.current,
        session: drawingSessionRef.current,
        priceTickSize: priceTickSizeRef.current,
      });
      // Volume has its own pane; price-scale margins remain usable price-pane space.
      const height = chartRef.current?.panes()[0]?.getHeight() ?? 0;
      textPrimitiveRef.current?.setDrawings({ drawings: drawingGroupsRef.current.text, timeline,
        selectedDrawingId: selectedDrawingIdRef.current, edit: textEditRef.current, drag: textDragRef.current });
      const position = textPositionRef.current;
      if (position) {
        const chart = chartRef.current, series = candleRef.current, host = interactionRef.current;
        const index = timeline.logicalIndexForAnchor(position.anchor);
        const x = index === null ? null : chart?.timeScale().logicalToCoordinate(index as never);
        const y = series?.priceToCoordinate(position.anchor.price);
        position.listener(host && x != null && y != null && Number.isFinite(x) && Number.isFinite(y)
          ? { host, x: Number(x), y: Number(y), width: chart?.timeScale().width() ?? 0, height } : null);
      }
    });
  }, []);
  useImperativeHandle(drawingApiRef, () => ({
    previewText(preview) {
      textEditRef.current = preview;
      if (preview?.inline || !preview) textPrimitiveRef.current?.setHovered(null);
      syncDrawingPrimitive();
    },
    consumeDoubleClick(pointer) { return textClicks.current!.consume(textEditRef.current?.id ?? null, pointer); },
    subscribePosition(anchor, listener) {
      const subscription = { anchor, listener };
      textPositionRef.current = subscription; syncDrawingPrimitive();
      return () => { if (textPositionRef.current === subscription) textPositionRef.current = null; };
    },
  }), [syncDrawingPrimitive]);

  const setChartCursor = useCallback((cursor: "" | "crosshair" | "ns-resize" | "move" | "pointer") => {
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = cursor;
    container.querySelectorAll("canvas").forEach((canvas) => { canvas.style.cursor = cursor; });
  }, []);

  useEffect(() => {
    syncDrawingPrimitive();
  }, [drawings, selectedDrawingId, syncDrawingPrimitive]);

  const syncMeasurementCoordinates = useCallback(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series) return;
    const current = measurementRef.current;
    if (!current) return;
    const currentBars = barsRef.current;
    const startIndex = current.start.timestamp === null
      ? current.start.index
      : currentBars.findIndex((bar) => bar.timestamp === current.start.timestamp);
    const endIndex = current.end.timestamp === null
      ? current.end.index
      : currentBars.findIndex((bar) => bar.timestamp === current.end.timestamp);
    if (
      (current.start.timestamp !== null && startIndex < 0)
      || (current.end.timestamp !== null && endIndex < 0)
    ) {
      measurementRef.current = null;
      setMeasurement(null);
      measurementArmedRef.current = false;
      onMeasurementArmedChangeRef.current(false);
      chart.applyOptions({
        crosshair: {
          vertLine: { visible: true, labelVisible: true },
          horzLine: { visible: true, labelVisible: true },
        },
      });
      setChartCursor("");
      return;
    }
    const startX = chart.timeScale().logicalToCoordinate(startIndex as never);
    const endX = chart.timeScale().logicalToCoordinate(endIndex as never);
    const startY = series.priceToCoordinate(current.start.price);
    const endY = series.priceToCoordinate(current.end.price);
    const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
    const paneWidth = chart.timeScale().width();
    if (startX === null || endX === null || startY === null || endY === null || paneHeight <= 0 || paneWidth <= 0) return;
    const next = {
      ...current,
      start: { ...current.start, index: startIndex, timestamp: currentBars[startIndex]?.timestamp ?? current.start.timestamp, x: Number(startX), y: Number(startY) },
      end: { ...current.end, index: endIndex, timestamp: currentBars[endIndex]?.timestamp ?? current.end.timestamp, x: Number(endX), y: Number(endY) },
      paneWidth,
      paneHeight,
      stats: calculateChartMeasurement({
        bars: currentBars,
        startIndex,
        endIndex,
        startPrice: current.start.price,
        endPrice: current.end.price,
        priceTickSize: priceTickSizeRef.current,
        displayIntervalSeconds: displayIntervalSecondsRef.current,
      }),
    };
    measurementRef.current = next;
    setMeasurement(next);
  }, [setChartCursor]);

  const syncVisibleSequenceRange = useCallback(() => {
    const chart = chartRef.current;
    // Paging reports the original timeline, even while part of it is visually hidden.
    const currentBars = timelineBarsRef.current;
    const range = chart?.timeScale().getVisibleLogicalRange();
    if (!range || !currentBars.length) return;
    const fromIndex = Math.max(0, Math.min(currentBars.length - 1, Math.floor(range.from)));
    const toIndex = Math.max(fromIndex, Math.min(currentBars.length - 1, Math.ceil(range.to)));
    onVisibleSequenceRangeChangeRef.current?.({
      fromSequence: currentBars[fromIndex].firstSequence,
      toSequence: currentBars[toIndex].lastSequence,
      barsBefore: fromIndex,
      barsAfter: currentBars.length - toIndex - 1,
    });
  }, []);

  useEffect(() => {
    if (!paperSessionId || paperInitialCapital === null) {
      setDefaultRiskAmount(null);
      return;
    }
    const fallback = paperInitialCapital * 0.01;
    try {
      const stored = JSON.parse(window.localStorage.getItem(`market-replay-risk-settings-v2:${replaySession?.id ?? datasetId}`) ?? "null") as { riskAmount?: unknown; targetR?: unknown } | null;
      const preferences = stored ?? replaySession?.riskPreferences;
      setDefaultRiskAmount(typeof preferences?.riskAmount === "number" && preferences.riskAmount > 0 ? preferences.riskAmount : fallback);
      setDefaultTargetR(typeof preferences?.targetR === "number" && preferences.targetR > 0 ? preferences.targetR : 2);
    } catch {
      setDefaultRiskAmount(fallback);
      setDefaultTargetR(2);
    }
  }, [datasetId, paperInitialCapital, paperSessionId, replaySession]);

  useEffect(() => {
    onDraftActiveChange(Boolean(draft));
  }, [draft, onDraftActiveChange]);

  const draftId = draft?.id ?? null;
  useEffect(() => {
    onDraftIdentityChange?.(draftId);
  }, [draftId, onDraftIdentityChange]);

  useEffect(() => {
    if (paperSessionId === null && draft !== null) {
      setDraft(null);
      setDraftError(null);
      setOrderTicketPosition(null);
    }
  }, [draft, paperSessionId]);

  useEffect(() => {
    if (!draft) return;
    const keepTicketInBounds = () => {
      const interaction = interactionRef.current;
      const ticket = orderTicketRef.current;
      if (!interaction || !ticket) return;
      const interactionRect = interaction.getBoundingClientRect();
      const ticketRect = ticket.getBoundingClientRect();
      setOrderTicketPosition((current) => current ? {
        x: Math.min(Math.max(8, current.x), Math.max(8, interactionRect.width - ticketRect.width - 8)),
        y: Math.min(Math.max(8, current.y), Math.max(8, interactionRect.height - ticketRect.height - 8)),
      } : current);
    };
    const frame = requestAnimationFrame(keepTicketInBounds);
    window.addEventListener("resize", keepTicketInBounds);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", keepTicketInBounds);
    };
  }, [draft]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  useEffect(() => { setContextMenu(null); }, [datasetId, displayIntervalSeconds, displaySession]);
  useLayoutEffect(() => {
    if (!contextMenu) return;
    const place = () => {
      const menu = contextMenuRef.current, root = interactionRef.current;
      if (!menu || !root) return;
      const x = Math.max(8, Math.min(contextMenu.x, root.clientWidth - menu.offsetWidth - 8));
      const y = Math.max(8, Math.min(contextMenu.y, root.clientHeight - menu.offsetHeight - 8));
      setContextMenu((current) => current && (current.x !== x || current.y !== y) ? { ...current, x, y } : current);
      if (!menu.contains(document.activeElement)) menu.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
    };
    place(); window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [contextMenu]);

  // Keep the chart instance stable. Window data, display interval, volume visibility,
  // and drawing preferences must update the existing instance so pointer handlers never
  // retain a removed chart or series.
  return {
    replaySession, visibilityScope, setHiddenBoundary, hiddenAfter, visibleBars, visibleWarmupBars,
    containerRef, interactionRef, orderTicketRef, orderTicketDragRef, chartRef, candleRef,
    volumeRef, priceLinesRef, lineTargetsRef, tradeAnnotationPrimitiveRef, barCountPrimitiveRef, candleCountdownPrimitiveRef,
    rectanglePrimitiveRef, trendLinePrimitiveRef, fibonacciPrimitiveRef, textPrimitiveRef, textEditRef, textClicks,
    textPositionRef, textDragRef, onPlaceTextRef, lastDataRef, lastDataRevisionRef, lastHiddenAfterRef,
    lastDataIntervalRef, lastDataSessionRef, displaySessionRef, barsRef, timelineBarsRef, projectionBars,
    projectionBarsRef, drawingTimelineRef, drawingScopeRef, drawingFrameRef, drawingSessionRef, requestedDrawingSessionRef,
    onFocusAppliedRef, tradeAnnotationsRef, tradeAnnotationsVisibleRef, candlestickStyleRef, measurementArmedRef, onMeasurementArmedChangeRef,
    drawingToolRef, drawingsRef, drawingGroupsRef, selectedDrawingIdRef, onDrawingToolChangeRef, onSelectedDrawingIdChangeRef,
    onCreateDrawingRef, onUpdateDrawingRef, onDeleteDrawingRef, onOpenDrawingStyleRef, displayIntervalSecondsRef, requestedDisplayIntervalSecondsRef,
    sourceIntervalSecondsRef, gridVisibleRef, contextMenu, setContextMenu, contextMenuRef, abrTooltip,
    setAbrTooltip, measurement, setMeasurement, measurementRef, drawingDraftRef, drawingDraftCoordinateRef,
    drawingPreviewRef, draft, setDraft, orderTicketPosition, setOrderTicketPosition, defaultRiskAmount,
    setDefaultRiskAmount, defaultTargetR, setDefaultTargetR, defaultSaved, setDefaultSaved, draftError,
    setDraftError, lineActions, setLineActions, hasVolume, warmupBarsRef, abrLengthRef,
    latest, currentPrice, currentPriceRef, displayUtcOffsetRef, onOrderPriceChangeRef, hasPendingClose,
    syncLineActionCoordinates, syncDrawingPrimitive, setChartCursor, syncMeasurementCoordinates, syncVisibleSequenceRange, datasetId,
    dataRevision, priceTickSize, bars, warmupBars, displayUtcOffsetMinutes, displayIntervalSeconds,
    measurementArmed, candlestickStyle, gridVisible, onToggleGrid, drawingTool, trendLineDraftStyle,
    fibonacciDraftStyle, rectangleDraftStyle, emaEnabled, emaIndicators, abrEnabled, abrLength,
    volumeVisible, displaySession, barCountSession, barCountConfig, paperSnapshot, tradeAnnotations,
    tradeAnnotationsTruncated, focusSequence, tradeAnnotationsVisible, candleCountdownEnabled, playbackActive, currentSourceTimestamp,
    sourceIntervalSeconds, readOnly, paperBusy, paperError, onSubmitOrder, onCancelOrder,
    onClosePosition, entryCheckOpen, onOpenPaperAccount, onRewindToBar, rewindRange,
  };
}
