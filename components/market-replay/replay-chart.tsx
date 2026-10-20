"use client";

import { syncPriceLine } from "@/lib/market-replay/price-lines";
import { createUuid } from "@/lib/uuid";
import { useReplaySession } from "./replay-session-context";

import { canUpdateReplayTail, formatChartTick, chartCandleData as candle, chartVolumeData as volume } from "@/lib/market-replay/chart-data";
import { aggregateHasGap, aggregatePhase } from "@/lib/market-replay/bar-quality";
import { formatInteger } from "@/lib/format";

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EyeOff, Grid2X2, GripHorizontal, Link2, Loader2, LogOut, RotateCcw, ShieldAlert, Undo2, X } from "lucide-react";
import {
  CandlestickSeries, ColorType, createChart, CrosshairMode,
  HistogramSeries, type IChartApi, type IPriceLine, type ISeriesApi,
  type Time, TickMarkType,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isClosingOrder } from "@/lib/paper-trading/training-gate";
import type { OrderSubmitResult } from "@/lib/paper-trading/types";
import type {
  AggregatedMarketBarData,
  BarCountIndicatorConfig,
  DisplaySession,
  EmaIndicatorConfig,
  TradingSessionConfig,
} from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
import {
  defaultReplayLogicalRange,
  rangeAfterNewReplayBar,
  rangeAfterTimelineChange,
  rangeAfterWindowReplacement,
  rangeForReplayFocus,
} from "@/lib/market-replay/chart-range";
import {
  candlestickSeriesStyleOptions,
  type CandlestickStyle,
} from "@/lib/market-replay/candlestick-style";
import {
  calculateChartMeasurement,
  calculateChartMeasurementGeometry,
  measurementDurationParts,
  type ChartMeasurementStats,
} from "@/lib/market-replay/chart-measurement";
import {
  anchorForLogicalIndex,
  DRAWING_TYPE_FIB_RETRACEMENT,
  DRAWING_TYPE_TREND_LINE,
  DRAWING_TYPE_RECTANGLE,
  isValidRectangleGeometry,
  type RectangleDrawing,
  type RectangleStyle,
  snapScreenPointTo45,
  type DrawingAnchor,
  type DrawingTool,
  type FibonacciRetracementDrawing,
  type FibonacciRetracementStyle,
  type MarketDrawing,
  type TrendLineDrawing,
  type TrendLineGeometry,
} from "@/lib/market-replay/chart-drawings";
import { drawingTimelineBars, DrawingTimelineLocator } from "@/lib/market-replay/drawing-timeline";
import { RectanglePrimitive, resizeRectangleGeometry, type RectangleHandle } from "@/lib/market-replay/rectangle-primitive";
import { TrendLinePrimitive } from "@/lib/market-replay/trend-line-primitive";
import { FibonacciRetracementPrimitive } from "@/lib/market-replay/fibonacci-retracement-primitive";
import { formatUtcDateTime, formatUtcOffset } from "@/lib/market-replay/display-timezone";
import { formatPriceForTick, priceDecimalsForTick, snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { ReplayTradeAnnotationPrimitive } from "@/lib/market-replay/trade-annotation-primitive";
import { BarCountPrimitive } from "@/lib/market-replay/bar-count-primitive";
import { CandleCountdownPrimitive } from "@/lib/market-replay/candle-countdown-primitive";
import {
  calculateRiskSizing,
  orderTypeForEntry,
  targetPriceForR,
  type RiskSizingError,
} from "@/lib/paper-trading/risk-sizing";
import {
  createBracketRReference,
  formatRMultiple,
  priceDifferenceFromEntry,
  protectiveOrderRReference,
  rMultipleAtPrice,
  type PriceRReference,
} from "@/lib/paper-trading/line-r-multiple";
import type { PaperSessionSnapshot, PaperSide, ReplayTradeAnnotationData } from "@/lib/paper-trading/types";
import { useReplayChartEma } from "./use-replay-chart-ema";
import { isReplayDrawingDeleteShortcut, isReplayShortcutInputTarget } from "@/lib/market-replay/keyboard-shortcuts";
import { chartRewindTarget, type ChartRewindRange, type ChartRewindTarget } from "@/lib/market-replay/chart-rewind";
import { chartBarsBeforeHiddenBoundary, chartHiddenSeriesData, chartHideAfterTarget, type ChartHideAfter } from "@/lib/market-replay/chart-hide-after";

type DraftOrder = {
  id: string;
  side: PaperSide;
  type: "LIMIT" | "STOP";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  targetR: number;
  tpMode: "LINKED" | "FREE";
};

type ContextMenuState = { x: number; y: number; price: number; rewindTarget: ChartRewindTarget | null; hideAfter: ChartHideAfter | null };
type AbrTooltipState = {
  left: number;
  top: number;
  bar: AggregatedMarketBarData;
  value: number | null;
};
type OrderUpdate = {
  price?: number;
  quantity?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskAmount?: number | null;
};
type LineTarget = {
  key: string;
  price: number;
  kind: "draft" | "order";
  field: "entryPrice" | "stopLoss" | "takeProfit" | "price";
  orderId?: string;
  rReference?: PriceRReference;
};
type LineAction = {
  key: string;
  price: number;
  y: number;
  color: string;
  label: string;
  kind: "cancel" | "close";
  orderId?: string;
};
type MeasurementPoint = {
  index: number;
  timestamp: string | null;
  price: number;
  x: number;
  y: number;
};
type MeasurementState = {
  phase: "tracking" | "fixed";
  start: MeasurementPoint;
  end: MeasurementPoint;
  paneWidth: number;
  paneHeight: number;
  stats: ChartMeasurementStats;
};
type DrawingDraft = {
  start: DrawingAnchor;
  end: DrawingAnchor;
};
type DrawingSegmentCoordinate = {
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type ReplayVisibleSequenceRange = {
  fromSequence: number;
  toSequence: number;
  barsBefore: number;
  barsAfter: number;
};

function sameLineActions(current: LineAction[], next: LineAction[]) {
  return current.length === next.length && current.every((action, index) => {
    const candidate = next[index];
    return action.key === candidate.key
      && action.price === candidate.price
      && action.y === candidate.y
      && action.color === candidate.color
      && action.label === candidate.label
      && action.kind === candidate.kind
      && action.orderId === candidate.orderId;
  });
}

function abrValueAt(
  warmupBars: AggregatedMarketBarData[],
  bars: AggregatedMarketBarData[],
  visibleIndex: number,
  length: number,
) {
  const end = warmupBars.length + visibleIndex;
  if (end < length - 1) return null;
  let sum = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const index = end - offset;
    const bar = index < warmupBars.length ? warmupBars[index] : bars[index - warmupBars.length];
    sum += Math.abs(bar.high - bar.low);
  }
  return sum / length;
}

function number(value: number, digits = 8) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

function money(value: number, currency: string) {
  return `${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
}

function compactVolume(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAbrValue(value: number | null, priceTickSize: number) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: Math.min(12, Math.max(2, priceDecimalsForTick(priceTickSize) + 2)),
  }).format(value);
}

function sizingErrorText(error: RiskSizingError) {
  const labels: Record<RiskSizingError, string> = {
    INVALID_PRICE: copy.paperTrading.invalidPrice,
    INVALID_RISK_AMOUNT: copy.paperTrading.invalidRiskAmount,
    INVALID_STOP_SIDE: copy.paperTrading.invalidStopSide,
    INVALID_TARGET_SIDE: copy.paperTrading.invalidTargetSide,
    INVALID_UNIT_RISK: copy.paperTrading.invalidUnitRisk,
    QUANTITY_LIMIT: copy.paperTrading.quantityLimit,
  };
  return labels[error];
}

function orderTypeLabel(type: "LIMIT" | "STOP") {
  return type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop;
}

function bracketPriceLineTitle(reference: PriceRReference | null, price: number, priceTickSize: number) {
  const ratio = formatRMultiple(rMultipleAtPrice(reference, price));
  const difference = priceDifferenceFromEntry(reference, price);
  return difference === null
    ? ratio
    : copy.paperTrading.priceLineRiskAndDifference(ratio, formatPriceForTick(difference, priceTickSize));
}

export function ReplayChart({
  datasetId, dataRevision = "", priceTickSize, bars, warmupBars, displayUtcOffsetMinutes, displayIntervalSeconds, measurementArmed,
  candlestickStyle, gridVisible = true, onToggleGrid,
  onMeasurementArmedChange, drawingTool, onDrawingToolChange, trendLineDraftStyle, fibonacciDraftStyle, rectangleDraftStyle, drawings, selectedDrawingId,
  onSelectedDrawingIdChange, onCreateDrawing, onUpdateDrawing, onDeleteDrawing,
  onOpenDrawingStyle, emaEnabled, emaIndicators, abrEnabled, abrLength, volumeVisible,
  displaySession, barCountSession, barCountConfig, paperSnapshot,
  tradeAnnotations, tradeAnnotationsTruncated, focusSequence = null, onFocusApplied,
  tradeAnnotationsVisible = true,
  candleCountdownEnabled = false, playbackActive = false, currentSourceTimestamp = null, sourceIntervalSeconds,
  readOnly = false,
  paperBusy, paperError, onSubmitOrder, onOrderPriceChange,
  onCancelOrder, onClosePosition, onDraftActiveChange, onDraftIdentityChange, entryCheckOpen = false, onOpenPaperAccount, onVisibleSequenceRangeChange,
  onRewindToBar, rewindRange,
}: {
  datasetId: string;
  dataRevision?: string;
  priceTickSize: number;
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  displayUtcOffsetMinutes: number;
  displayIntervalSeconds: number;
  sourceIntervalSeconds?: number;
  candleCountdownEnabled?: boolean;
  playbackActive?: boolean;
  currentSourceTimestamp?: string | null;
  measurementArmed: boolean;
  candlestickStyle: CandlestickStyle;
  onMeasurementArmedChange: (armed: boolean) => void;
  rectangleDraftStyle: RectangleStyle;
  drawingTool: DrawingTool | null;
  onDrawingToolChange: (tool: DrawingTool | null) => void;
  trendLineDraftStyle: TrendLineDrawing["style"];
  fibonacciDraftStyle: FibonacciRetracementStyle;
  drawings: MarketDrawing[];
  selectedDrawingId: string | null;
  onSelectedDrawingIdChange: (id: string | null) => void;
  onCreateDrawing: (type: DrawingTool, geometry: TrendLineGeometry) => void;
  onUpdateDrawing: (id: string, geometry: TrendLineGeometry) => void;
  onDeleteDrawing: (id: string) => void;
  onOpenDrawingStyle: (id: string) => void;
  emaEnabled: boolean;
  emaIndicators: EmaIndicatorConfig[];
  abrEnabled: boolean;
  abrLength: number;
  volumeVisible: boolean;
  gridVisible?: boolean;
  onToggleGrid?: () => void;
  displaySession: DisplaySession;
  barCountSession: TradingSessionConfig;
  barCountConfig: BarCountIndicatorConfig;
  paperSnapshot: PaperSessionSnapshot | null;
  tradeAnnotations: ReplayTradeAnnotationData[];
  tradeAnnotationsTruncated: boolean;
  tradeAnnotationsVisible?: boolean;
  focusSequence?: number | null;
  onFocusApplied?: () => void;
  readOnly?: boolean;
  paperBusy: boolean;
  paperError: string | null;
  onSubmitOrder: (order: { side: PaperSide; type: "LIMIT" | "STOP"; quantity: number; riskAmount: number; price: number; stopLoss: number; takeProfit: number }, draftId?: string) => Promise<boolean | OrderSubmitResult>;
  onOrderPriceChange: (orderId: string, update: OrderUpdate) => Promise<boolean>;
  onCancelOrder: (orderId: string) => Promise<boolean>;
  onClosePosition: () => Promise<boolean>;
  onDraftActiveChange: (active: boolean) => void;
  onDraftIdentityChange?: (draftId: string | null) => void;
  entryCheckOpen?: boolean;
  onOpenPaperAccount: () => void;
  onVisibleSequenceRangeChange?: (range: ReplayVisibleSequenceRange) => void;
  onRewindToBar?: (target: ChartRewindTarget) => void;
  rewindRange?: ChartRewindRange;
}) {
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
    const trend: TrendLineDrawing[] = [], fibonacci: FibonacciRetracementDrawing[] = [], rectangle: RectangleDrawing[] = [];
    for (const drawing of drawings) {
      if (drawing.type === DRAWING_TYPE_RECTANGLE) rectangle.push(drawing);
      else if (drawing.type === DRAWING_TYPE_TREND_LINE) trend.push(drawing);
      else fibonacci.push(drawing);
    }
    return { trend, fibonacci, rectangle };
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
    });
  }, []);

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
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const priceLines = priceLinesRef.current;
    const lineTargets = lineTargetsRef.current;
    const chart = createChart(container, {
      width: container.clientWidth, height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "#fff" }, textColor: "#475569", attributionLogo: true, panes: { separatorColor: "#e2e8f0", separatorHoverColor: "#cbd5e1" } },
      grid: { vertLines: { color: "#f1f5f9", visible: gridVisibleRef.current }, horzLines: { color: "#f1f5f9", visible: gridVisibleRef.current } },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "zh-CN", timeFormatter: (time: Time) => typeof time === "number" ? formatUtcDateTime(time * 1_000, displayUtcOffsetRef.current) : String(time) },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        shiftVisibleRangeOnNewBar: false,
        lockVisibleTimeRangeOnResize: true,
        enableConflation: true,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatChartTick(time, tickMarkType, displayUtcOffsetRef.current),
      },
      rightPriceScale: { borderColor: "#e2e8f0" },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      ...candlestickSeriesStyleOptions(candlestickStyleRef.current),
      priceFormat: { type: "price", minMove: priceTickSize, precision: priceDecimalsForTick(priceTickSize) },
    });
    const trendLinePrimitive = new TrendLinePrimitive();
    const fibonacciPrimitive = new FibonacciRetracementPrimitive();
    const tradeAnnotationPrimitive = new ReplayTradeAnnotationPrimitive();
    const barCountPrimitive = new BarCountPrimitive();
    const candleCountdownPrimitive = new CandleCountdownPrimitive();
    const rectanglePrimitive = new RectanglePrimitive();
    candles.attachPrimitive(rectanglePrimitive);
    candles.attachPrimitive(trendLinePrimitive);
    candles.attachPrimitive(fibonacciPrimitive);
    candles.attachPrimitive(tradeAnnotationPrimitive);
    candles.attachPrimitive(barCountPrimitive);
    candles.attachPrimitive(candleCountdownPrimitive);
    tradeAnnotationPrimitive.setData({
      entries: tradeAnnotationsVisibleRef.current ? tradeAnnotationsRef.current : [],
      bars: barsRef.current,
    });
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width && entry.contentRect.height) {
        chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
        syncLineActionCoordinates();
        syncMeasurementCoordinates();
      }
    });
    observer.observe(container);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncMeasurementCoordinates);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncVisibleSequenceRange);
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = null;
    rectanglePrimitiveRef.current = rectanglePrimitive;
    trendLinePrimitiveRef.current = trendLinePrimitive;
    fibonacciPrimitiveRef.current = fibonacciPrimitive;
    tradeAnnotationPrimitiveRef.current = tradeAnnotationPrimitive;
    barCountPrimitiveRef.current = barCountPrimitive;
    candleCountdownPrimitiveRef.current = candleCountdownPrimitive;
    syncDrawingPrimitive();
    return () => {
      if (drawingFrameRef.current !== null) {
        cancelAnimationFrame(drawingFrameRef.current);
        drawingFrameRef.current = null;
      }
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMeasurementCoordinates);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncVisibleSequenceRange);
      candles.detachPrimitive(rectanglePrimitive);
      candles.detachPrimitive(trendLinePrimitive);
      candles.detachPrimitive(fibonacciPrimitive);
      candles.detachPrimitive(tradeAnnotationPrimitive);
      candles.detachPrimitive(barCountPrimitive);
      candles.detachPrimitive(candleCountdownPrimitive);
      rectanglePrimitiveRef.current = null;
      trendLinePrimitiveRef.current = null;
      fibonacciPrimitiveRef.current = null;
      tradeAnnotationPrimitiveRef.current = null;
      barCountPrimitiveRef.current = null;
      candleCountdownPrimitiveRef.current = null;
      chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      priceLines.clear(); lineTargets.clear(); lastDataRef.current = [];
    };
  }, [priceTickSize, syncDrawingPrimitive, syncLineActionCoordinates, syncMeasurementCoordinates, syncVisibleSequenceRange]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: { vertLines: { visible: gridVisible }, horzLines: { visible: gridVisible } },
    });
  }, [gridVisible]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!volumeVisible || !hasVolume) {
      const volumes = volumeRef.current;
      if (volumes) {
        volumeRef.current = null;
        chart.removeSeries(volumes);
        chart.panes()[0]?.setStretchFactor(1);
      }
      return;
    }
    if (volumeRef.current) return;
    const pane = chart.addPane();
    chart.panes()[0]?.setStretchFactor(4);
    pane.setStretchFactor(1);
    const volumes = pane.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeRef.current = volumes;
    volumes.setData(barsRef.current.filter((bar) => bar.volume !== null).map((bar) => volume(bar)));
  }, [hasVolume, volumeVisible]);

  useEffect(() => {
    candleRef.current?.applyOptions(candlestickSeriesStyleOptions(candlestickStyle));
  }, [candlestickStyle]);

  useEffect(() => {
    displayUtcOffsetRef.current = displayUtcOffsetMinutes;
    chartRef.current?.applyOptions({
      localization: {
        locale: "zh-CN",
        timeFormatter: (time: Time) => typeof time === "number" ? formatUtcDateTime(time * 1_000, displayUtcOffsetMinutes) : String(time),
      },
      timeScale: {
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatChartTick(time, tickMarkType, displayUtcOffsetMinutes),
      },
    });
  }, [displayUtcOffsetMinutes]);

  useEffect(() => {
    syncDrawingPrimitive();
  }, [fibonacciDraftStyle, rectangleDraftStyle, syncDrawingPrimitive, trendLineDraftStyle]);

  useEffect(() => {
    const chart = chartRef.current; const series = candleRef.current;
    if (!chart || !series) return;
    const nextDisplayIntervalSeconds = requestedDisplayIntervalSecondsRef.current;
    const nextDisplaySession = displaySessionRef.current;
    const previous = lastDataRef.current;
    const next = bars;
    barsRef.current = visibleBars;
    timelineBarsRef.current = next;
    projectionBarsRef.current = projectionBars;
    drawingScopeRef.current = visibilityScope;
    displayIntervalSecondsRef.current = nextDisplayIntervalSeconds;
    drawingSessionRef.current = requestedDrawingSessionRef.current;
    const volumeSeries = volumeRef.current;
    const candleWasAutoScaled = series.priceScale().options().autoScale;
    const volumeWasAutoScaled = volumeSeries?.priceScale().options().autoScale ?? true;
    const samePrefix = canUpdateReplayTail(previous, next, lastDataRevisionRef.current, dataRevision);
    if (samePrefix && !hiddenAfter && !lastHiddenAfterRef.current) {
      const range = chart.timeScale().getVisibleLogicalRange();
      const previousLastIndex = previous.length - 1;
      for (const bar of next.slice(Math.max(0, previous.length - 1))) {
        series.update(candle(bar)); if (bar.volume !== null) volumeSeries?.update(volume(bar));
      }
      if (range && next.length > previous.length && !readOnly) {
        chart.timeScale().setVisibleLogicalRange(rangeAfterNewReplayBar(range, previousLastIndex, next.length - previous.length));
      }
    } else {
      const range = chart.timeScale().getVisibleLogicalRange();
      const previousLastIndex = previous.length - 1;
      const previousLastInNext = next.findIndex((bar) => bar.timestamp === previous.at(-1)?.timestamp);
      const timelineChanged = lastDataIntervalRef.current !== nextDisplayIntervalSeconds
        || lastDataSessionRef.current !== nextDisplaySession;
      const mappedTimelineRange = range && timelineChanged
        ? rangeAfterTimelineChange({
          visibleRange: range,
          previousBars: previous,
          nextBars: next,
          previousDisplayIntervalSeconds: lastDataIntervalRef.current,
          nextDisplayIntervalSeconds,
        })
        : null;
      // Whitespace retains the original time axis and viewport without exposing prices.
      if (hiddenAfter) {
        const masked = chartHiddenSeriesData(next, visibleBars);
        series.setData(masked.candles);
        volumeSeries?.setData(masked.volumes);
      } else {
        series.setData(next.map(candle));
        volumeSeries?.setData(next.filter((bar) => bar.volume !== null).map((bar) => volume(bar)));
      }
      if (mappedTimelineRange) {
        chart.timeScale().setVisibleLogicalRange(mappedTimelineRange);
      } else if (range && previousLastInNext >= 0) {
        // A rolling server window renumbers logical indices. Preserve zoom and historical panning.
        const advanced = readOnly ? range : rangeAfterNewReplayBar(range, previousLastIndex, next.length - 1 - previousLastInNext);
        const removed = previousLastIndex - previousLastInNext;
        chart.timeScale().setVisibleLogicalRange({ from: advanced.from - removed, to: advanced.to - removed });
      } else if (next.length > 0) {
        chart.timeScale().setVisibleLogicalRange(
          previous.length > 0 && range
            ? rangeAfterWindowReplacement(range, previousLastIndex, next.length - 1)
            : defaultReplayLogicalRange(chart.timeScale().width(), next.length),
        );
      }
    }
    // Keep a user-selected manual price scale through every incremental update or window swap.
    if (!candleWasAutoScaled && series.priceScale().options().autoScale) {
      series.priceScale().applyOptions({ autoScale: false });
    }
    if (volumeSeries && !volumeWasAutoScaled && volumeSeries.priceScale().options().autoScale) {
      volumeSeries.priceScale().applyOptions({ autoScale: false });
    }
    lastDataRef.current = next;
    lastDataRevisionRef.current = dataRevision;
    lastHiddenAfterRef.current = hiddenAfter;
    lastDataIntervalRef.current = nextDisplayIntervalSeconds;
    lastDataSessionRef.current = nextDisplaySession;
    requestAnimationFrame(syncVisibleSequenceRange);
    requestAnimationFrame(syncMeasurementCoordinates);
    syncDrawingPrimitive();
  }, [bars, dataRevision, projectionBars, visibleBars, hiddenAfter, readOnly, visibilityScope, displayIntervalSeconds, displaySession, barCountSession, sourceIntervalSeconds, syncDrawingPrimitive, syncMeasurementCoordinates, syncVisibleSequenceRange]);

  useEffect(() => {
    if (focusSequence === null) return;
    const chart = chartRef.current;
    if (!chart) return;
    const range = rangeForReplayFocus(bars, focusSequence, chart.timeScale().getVisibleLogicalRange());
    if (!range) return;
    chart.timeScale().setVisibleLogicalRange(range);
    onFocusAppliedRef.current?.();
  }, [bars, focusSequence]);

  useEffect(() => {
    tradeAnnotationPrimitiveRef.current?.setData({
      entries: tradeAnnotationsVisible ? tradeAnnotations : [],
      bars: visibleBars,
    });
  }, [visibleBars, tradeAnnotations, tradeAnnotationsVisible]);

  useEffect(() => {
    barCountPrimitiveRef.current?.setData({
      bars: visibleBars,
      displaySession,
      displayIntervalSeconds,
      session: barCountSession,
      config: barCountConfig,
    });
  }, [barCountConfig, barCountSession, visibleBars, displayIntervalSeconds, displaySession]);

  useEffect(() => {
    candleCountdownPrimitiveRef.current?.setData({
      bars: visibleBars,
      currentSourceTimestamp,
      enabled: candleCountdownEnabled && !hiddenAfter,
      playing: playbackActive,
      sourceIntervalSeconds: sourceIntervalSeconds ?? displayIntervalSeconds,
    });
  }, [visibleBars, hiddenAfter, candleCountdownEnabled, currentSourceTimestamp, displayIntervalSeconds, playbackActive, sourceIntervalSeconds]);

  useReplayChartEma({
    chartRef,
    bars: visibleBars,
    warmupBars: visibleWarmupBars,
    enabled: emaEnabled,
    indicators: emaIndicators,
    chartKey: priceTickSize,
  });

  const draftSizing = useMemo(() => {
    if (!draft || !paperSnapshot) return null;
    return calculateRiskSizing({
      side: draft.side, type: draft.type, entryPrice: draft.entryPrice,
      stopLoss: draft.stopLoss, takeProfit: draft.takeProfit, riskAmount: draft.riskAmount,
      commissionBps: paperSnapshot.session.commissionBps,
      slippageBps: paperSnapshot.session.slippageBps,
    });
  }, [draft, paperSnapshot]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const nextKeys = new Set<string>();
    lineTargetsRef.current.clear();
    const nextLineActions: LineAction[] = [];
    // Live order and position lines stay usable when historical annotations are hidden.
    const addLine = (target: LineTarget | null, price: number, color: string, title: string, solid = false) => {
      const key = target?.key ?? "position";
      nextKeys.add(key);
      syncPriceLine(priceLinesRef.current, key, { price, color, lineWidth: 1, lineStyle: solid ? 0 : 2, axisLabelVisible: true, title },
        options => series.createPriceLine(options));
      if (target) lineTargetsRef.current.set(key, target);
    };
    const addAction = (action: Omit<LineAction, "y">) => {
      const coordinate = series.priceToCoordinate(action.price);
      if (coordinate !== null) nextLineActions.push({ ...action, y: Number(coordinate) });
    };
    if (paperSnapshot?.session.averageEntryPrice !== null && paperSnapshot?.session.averageEntryPrice !== undefined && paperSnapshot.session.netQuantity !== 0) {
      addLine(null, paperSnapshot.session.averageEntryPrice, "#475569", copy.paperTrading.positionValue(paperSnapshot.session.netQuantity, paperSnapshot.session.averageEntryPrice));
      addAction({ key: "position", price: paperSnapshot.session.averageEntryPrice, color: "#475569", label: copy.paperTrading.positionValue(paperSnapshot.session.netQuantity, paperSnapshot.session.averageEntryPrice), kind: "close" });
    }
    for (const order of paperSnapshot?.activeOrders ?? []) {
      if (order.price !== null) {
        const isStop = order.isProtective && order.type === "STOP";
        const color = isStop ? "#dc2626" : order.isProtective ? "#16a34a" : order.side === "BUY" ? "#2563eb" : "#ea580c";
        const rReference = order.isProtective ? protectiveOrderRReference(paperSnapshot!, order) : null;
        const title = order.isProtective
          ? bracketPriceLineTitle(rReference, order.price, priceTickSize)
          : copy.paperTrading.orderLine(order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell, order.type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop);
        addLine({ key: order.id, price: order.price, kind: "order", field: "price", orderId: order.id, rReference: rReference ?? undefined }, order.price, color, title, order.isProtective);
        addAction({ key: order.id, price: order.price, color, label: order.isProtective ? title : `${title} · ${number(order.quantity)}`, kind: "cancel", orderId: order.id });
      }
      if (!order.isProtective && order.stopLoss !== null) {
        const reference = order.price === null ? null : createBracketRReference(order.side, order.price, order.stopLoss);
        const title = bracketPriceLineTitle(reference, order.stopLoss, priceTickSize);
        addLine({ key: `${order.id}:sl`, price: order.stopLoss, kind: "order", field: "stopLoss", orderId: order.id, rReference: reference ?? undefined }, order.stopLoss, "#dc2626", title, true);
      }
      if (!order.isProtective && order.takeProfit !== null) {
        const reference = order.price === null || order.stopLoss === null ? null : createBracketRReference(order.side, order.price, order.stopLoss);
        const title = bracketPriceLineTitle(reference, order.takeProfit, priceTickSize);
        addLine({ key: `${order.id}:tp`, price: order.takeProfit, kind: "order", field: "takeProfit", orderId: order.id, rReference: reference ?? undefined }, order.takeProfit, "#16a34a", title, true);
      }
    }
    if (draft && paperSnapshot) {
      const side = draft.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell;
      const reference = createBracketRReference(draft.side, draft.entryPrice, draft.stopLoss);
      addLine({ key: "draft:entry", price: draft.entryPrice, kind: "draft", field: "entryPrice" }, draft.entryPrice, "rgba(37,99,235,0.5)", copy.paperTrading.orderLine(side, orderTypeLabel(draft.type)), true);
      addLine({ key: "draft:sl", price: draft.stopLoss, kind: "draft", field: "stopLoss" }, draft.stopLoss, "rgba(220,38,38,0.5)", bracketPriceLineTitle(reference, draft.stopLoss, priceTickSize), true);
      addLine({ key: "draft:tp", price: draft.takeProfit, kind: "draft", field: "takeProfit" }, draft.takeProfit, "rgba(22,163,74,0.5)", bracketPriceLineTitle(reference, draft.takeProfit, priceTickSize), true);
    }
    for (const [key, line] of priceLinesRef.current) if (!nextKeys.has(key)) {
      series.removePriceLine(line);
      priceLinesRef.current.delete(key);
    }
    setLineActions((current) => sameLineActions(current, nextLineActions) ? current : nextLineActions);
  }, [draft, paperSnapshot, priceTickSize]);

  const moveDraftLine = useCallback((current: DraftOrder, field: LineTarget["field"], price: number): DraftOrder => {
    price = snapPriceToTick(price, priceTickSize);
    const livePrice = currentPriceRef.current;
    if (!Number.isFinite(price) || price <= 0 || livePrice === null) return current;
    if (field === "stopLoss") {
      if ((current.side === "BUY" && price >= current.entryPrice) || (current.side === "SELL" && price <= current.entryPrice)) return current;
      return { ...current, stopLoss: price, takeProfit: current.tpMode === "LINKED" ? snapPriceToTick(targetPriceForR(current.side, current.entryPrice, price, current.targetR), priceTickSize) : current.takeProfit };
    }
    if (field === "takeProfit") {
      if ((current.side === "BUY" && price <= current.entryPrice) || (current.side === "SELL" && price >= current.entryPrice)) return current;
      return { ...current, takeProfit: price, tpMode: "FREE" };
    }
    if (field === "entryPrice") {
      const valid = current.side === "BUY"
        ? price > current.stopLoss && price < current.takeProfit
        : price < current.stopLoss && price > current.takeProfit;
      if (!valid) return current;
      return {
        ...current,
        entryPrice: price,
        type: orderTypeForEntry(current.side, price, livePrice),
        takeProfit: current.tpMode === "LINKED" ? snapPriceToTick(targetPriceForR(current.side, price, current.stopLoss, current.targetR), priceTickSize) : current.takeProfit,
      };
    }
    return current;
  }, [priceTickSize]);

  useEffect(() => {
    const container = containerRef.current;
    const interaction = interactionRef.current;
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!container || !interaction || !chart || !series) return;

    type PositionedAnchor = { anchor: DrawingAnchor; coordinate: { x: number; y: number } };
    let dragging: {
      id: string;
      kind: "start" | "end" | "line" | RectangleHandle;
      clientX: number;
      clientY: number;
      geometry: TrendLineGeometry;
      start: { x: number; y: number };
      end: { x: number; y: number };
    } | null = null;

    const pointAtCoordinate = (x: number, y: number, requireInside: boolean): PositionedAnchor | null => {
      const currentBars = barsRef.current;
      const paneWidth = chart.timeScale().width();
      const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
      if (!currentBars.length || paneWidth <= 0 || paneHeight <= 0) return null;
      if (requireInside && (x < 0 || x > paneWidth || y < 0 || y > paneHeight)) return null;
      const logical = chart.timeScale().coordinateToLogical(x as never);
      const rawPrice = series.coordinateToPrice(y as never);
      if (logical === null || rawPrice === null || !Number.isFinite(Number(rawPrice))) return null;
      const index = Math.round(Number(logical));
      const price = snapPriceToTick(Number(rawPrice), priceTickSize);
      if (!Number.isFinite(price)) return null;
      const snappedX = chart.timeScale().logicalToCoordinate(index as never);
      const snappedY = series.priceToCoordinate(price);
      if (snappedX === null || snappedY === null
        || drawingTimelineRef.current.timestampForLogicalIndex(index) === null) return null;
      return {
        anchor: anchorForLogicalIndex({
          logicalIndex: index,
          price,
          bars: currentBars,
          displayIntervalSeconds: displayIntervalSecondsRef.current,
          sourceIntervalSeconds: sourceIntervalSecondsRef.current,
          session: drawingSessionRef.current,
          timeline: drawingTimelineRef.current,
        }),
        coordinate: { x: Number(snappedX), y: Number(snappedY) },
      };
    };
    const pointAt = (clientX: number, clientY: number, requireInside = true) => {
      const rect = container.getBoundingClientRect();
      return pointAtCoordinate(clientX - rect.left, clientY - rect.top, requireInside);
    };
    const commitDraft = (next: DrawingDraft | null, coordinate: DrawingSegmentCoordinate | null) => {
      drawingDraftRef.current = next;
      drawingDraftCoordinateRef.current = coordinate;
      syncDrawingPrimitive();
    };
    const commitPreview = (next: { id: string; geometry: TrendLineGeometry } | null) => {
      drawingPreviewRef.current = next;
      syncDrawingPrimitive();
    };
    const stopEvent = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setContextMenu(null);
    };
    const hitDrawingAt = (point: { x: number; y: number }) => {
      const trend = trendLinePrimitiveRef.current?.hitTestAt(point) ?? null;
      const fibonacci = fibonacciPrimitiveRef.current?.hitTestAt(point) ?? null;
      const rectangle = rectanglePrimitiveRef.current?.hitTestAt(point) ?? null;
      return [trend, fibonacci, rectangle].filter(item => item !== null)
        .sort((a, b) => b.priority - a.priority || a.distance - b.distance)[0] ?? null;
    };
    const drawingCoordinates = (drawing: MarketDrawing) => (
      drawing.type === DRAWING_TYPE_RECTANGLE ? rectanglePrimitiveRef.current?.getDrawingCoordinates(drawing.id)
        : drawing.type === DRAWING_TYPE_TREND_LINE
        ? trendLinePrimitiveRef.current?.getDrawingCoordinates(drawing.id)
        : fibonacciPrimitiveRef.current?.getDrawingCoordinates(drawing.id)
    );

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !interaction.contains(event.target as Node)) return;
      const target = event.target as HTMLElement;
      if (target.closest("button,input,[data-context-menu],[data-order-ticket],[data-line-action]")) return;

      if (drawingToolRef.current) {
        const activeTool = drawingToolRef.current;
        const initial = pointAt(event.clientX, event.clientY);
        if (!initial) return;
        stopEvent(event);
        const current = drawingDraftRef.current;
        if (!current) {
          commitDraft(
            { start: initial.anchor, end: initial.anchor },
            { start: initial.coordinate, end: initial.coordinate },
          );
          onSelectedDrawingIdChangeRef.current(null);
          setChartCursor("crosshair");
          return;
        }
        let end = initial;
        const draftCoordinate = drawingDraftCoordinateRef.current;
        if (activeTool === DRAWING_TYPE_TREND_LINE && event.shiftKey && draftCoordinate) {
          const rect = container.getBoundingClientRect();
          const snapped = snapScreenPointTo45(draftCoordinate.start, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
          end = pointAtCoordinate(snapped.x, snapped.y, false) ?? initial;
        }
        const geometry = { start: current.start, end: end.anchor };
        if (activeTool === DRAWING_TYPE_RECTANGLE && !isValidRectangleGeometry(geometry)) return;
        onCreateDrawingRef.current(activeTool, geometry);
        commitDraft(null, null);
        drawingToolRef.current = null;
        onDrawingToolChangeRef.current(null);
        setChartCursor("");
        return;
      }

      const rect = container.getBoundingClientRect();
      // Let existing order controls and measurement gestures take precedence over zones.
      if (measurementArmedRef.current || event.shiftKey) return;
      const hit = hitDrawingAt({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      if (!hit) {
        if (!event.shiftKey) onSelectedDrawingIdChangeRef.current(null);
        return;
      }
      if (drawingsRef.current.find(d => d.id === hit.drawingId)?.type === DRAWING_TYPE_RECTANGLE
        && [...lineTargetsRef.current.values()].some(target => {
          const y = series.priceToCoordinate(target.price);
          return y !== null && Math.abs(Number(y) - (event.clientY - rect.top)) <= 8;
        })) return;
      const id = hit.drawingId;
      const drawing = drawingsRef.current.find((item) => item.id === id);
      const coordinate = drawing ? drawingCoordinates(drawing) : null;
      if (!drawing || !coordinate || id.startsWith("temporary-")) return;
      stopEvent(event);
      onSelectedDrawingIdChangeRef.current(id);
      selectedDrawingIdRef.current = id;
      dragging = {
        id,
        kind: hit.part,
        clientX: event.clientX,
        clientY: event.clientY,
        geometry: drawing.geometry,
        start: coordinate.start,
        end: coordinate.end,
      };
      interaction.setPointerCapture(event.pointerId);
      chart.applyOptions({ handleScroll: false });
      setChartCursor(dragging.kind === "line" ? "move" : "crosshair");
    };

    const processDrawingMove = (event: PointerEvent) => {
      const draft = drawingDraftRef.current;
      if (drawingToolRef.current && draft) {
        const initial = pointAt(event.clientX, event.clientY);
        if (!initial) return;
        let end = initial;
        const currentCoordinate = drawingDraftCoordinateRef.current;
        if (drawingToolRef.current === DRAWING_TYPE_TREND_LINE && event.shiftKey && currentCoordinate) {
          const rect = container.getBoundingClientRect();
          const snapped = snapScreenPointTo45(currentCoordinate.start, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
          end = pointAtCoordinate(snapped.x, snapped.y, false) ?? initial;
        }
        stopEvent(event);
        commitDraft(
          { start: draft.start, end: end.anchor },
          { start: drawingDraftCoordinateRef.current?.start ?? end.coordinate, end: end.coordinate },
        );
        return;
      }
      if (!dragging) return;
      stopEvent(event);
      let geometry: TrendLineGeometry | null = null;
      if (dragging.kind === "line") {
        const dx = event.clientX - dragging.clientX;
        const dy = event.clientY - dragging.clientY;
        const start = pointAtCoordinate(dragging.start.x + dx, dragging.start.y + dy, false);
        const end = pointAtCoordinate(dragging.end.x + dx, dragging.end.y + dy, false);
        if (start && end) {
          geometry = { start: start.anchor, end: end.anchor };
          if (drawingsRef.current.find(item => item.id === dragging!.id)?.type === DRAWING_TYPE_RECTANGLE) {
            if (start.coordinate.x === dragging.start.x) geometry.start = { ...geometry.start,
              timestamp: dragging.geometry.start.timestamp, sourceSequence: dragging.geometry.start.sourceSequence };
            if (end.coordinate.x === dragging.end.x) geometry.end = { ...geometry.end,
              timestamp: dragging.geometry.end.timestamp, sourceSequence: dragging.geometry.end.sourceSequence };
          }
        }
      } else if (dragging.kind !== "start" && dragging.kind !== "end") {
        const rect = container.getBoundingClientRect();
        geometry = resizeRectangleGeometry(dragging.geometry, dragging.start, dragging.end, dragging.kind,
          { x: event.clientX - rect.left, y: event.clientY - rect.top }, point => pointAtCoordinate(point.x, point.y, false)?.anchor ?? null);
      } else {
        const movingStart = dragging.kind === "start";
        const otherCoordinate = movingStart ? dragging.end : dragging.start;
        const rect = container.getBoundingClientRect();
        let coordinate = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        if (dragging && drawingsRef.current.find((item) => item.id === dragging!.id)?.type === DRAWING_TYPE_TREND_LINE && event.shiftKey) {
          coordinate = snapScreenPointTo45(otherCoordinate, coordinate);
        }
        const point = pointAtCoordinate(coordinate.x, coordinate.y, false);
        if (point) {
          geometry = movingStart
            ? { start: point.anchor, end: dragging.geometry.end }
            : { start: dragging.geometry.start, end: point.anchor };
        }
      }
      if (geometry && (drawingsRef.current.find(item => item.id === dragging!.id)?.type !== DRAWING_TYPE_RECTANGLE
        || isValidRectangleGeometry(geometry))) commitPreview({ id: dragging.id, geometry });
    };

    let pointerFrame: number | null = null;
    let pendingPointer: PointerEvent | null = null;
    const clearPointerFrame = () => {
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
      pointerFrame = null;
      pendingPointer = null;
    };
    const move = (event: PointerEvent) => {
      if (!dragging && !(drawingToolRef.current && drawingDraftRef.current)) return;
      stopEvent(event);
      pendingPointer = event;
      if (pointerFrame !== null) return;
      pointerFrame = requestAnimationFrame(() => {
        const pointer = pendingPointer;
        clearPointerFrame();
        if (pointer) processDrawingMove(pointer);
      });
    };
    const finish = (event: PointerEvent) => {
      if (!dragging) return;
      const moved = pendingPointer !== null || event.clientX !== dragging.clientX || event.clientY !== dragging.clientY;
      clearPointerFrame();
      if (moved) processDrawingMove(event);
      stopEvent(event);
      const preview = drawingPreviewRef.current;
      if (preview?.id === dragging.id && (["start", "end"] as const).some(part => {
        const before = dragging!.geometry[part], after = preview.geometry[part];
        return before.price !== after.price || before.timestamp !== after.timestamp || before.sourceSequence !== after.sourceSequence;
      })) onUpdateDrawingRef.current(preview.id, preview.geometry);
      dragging = null;
      requestAnimationFrame(() => commitPreview(null));
      if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
      chart.applyOptions({ handleScroll: true });
      setChartCursor("");
    };
    const cancelDrag = () => {
      clearPointerFrame();
      dragging = null;
      commitPreview(null);
      chart.applyOptions({ handleScroll: true });
      setChartCursor(drawingToolRef.current ? "crosshair" : "");
    };
    const doubleClick = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const id = hitDrawingAt({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })?.drawingId;
      if (!id || id.startsWith("temporary-")) return;
      stopEvent(event);
      onOpenDrawingStyleRef.current(id);
    };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isReplayShortcutInputTarget(event.target)) return;
      if (event.key === "Escape" && dragging) {
        stopEvent(event);
        cancelDrag();
        return;
      }
      if (event.key === "Escape" && (drawingToolRef.current || drawingDraftRef.current)) {
        stopEvent(event);
        commitDraft(null, null);
        drawingToolRef.current = null;
        onDrawingToolChangeRef.current(null);
        setChartCursor("");
        return;
      }
      if (event.key === "Escape" && selectedDrawingIdRef.current) {
        onSelectedDrawingIdChangeRef.current(null);
        return;
      }
      if (isReplayDrawingDeleteShortcut(event) && selectedDrawingIdRef.current) {
        stopEvent(event);
        onDeleteDrawingRef.current(selectedDrawingIdRef.current);
      }
    };

    interaction.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    window.addEventListener("blur", cancelDrag);
    interaction.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key, true);
    return () => {
      clearPointerFrame();
      interaction.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
      window.removeEventListener("blur", cancelDrag);
      interaction.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [priceTickSize, setChartCursor, syncDrawingPrimitive]);

  useEffect(() => {
    if (drawingTool) {
      setChartCursor("crosshair");
      return;
    }
    if (drawingDraftRef.current) {
      drawingDraftRef.current = null;
      drawingDraftCoordinateRef.current = null;
      syncDrawingPrimitive();
    }
    if (!measurementRef.current) setChartCursor("");
  }, [drawingTool, setChartCursor, syncDrawingPrimitive]);

  useEffect(() => {
    const container = containerRef.current;
    const interaction = interactionRef.current;
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!container || !interaction || !chart || !series) return;

    const pointAt = (clientX: number, clientY: number) => {
      const currentBars = barsRef.current;
      const paneWidth = chart.timeScale().width();
      const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
      if (currentBars.length === 0 || paneWidth <= 0 || paneHeight <= 0) return null;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || x > paneWidth || y < 0 || y > paneHeight) return null;
      const logical = chart.timeScale().coordinateToLogical(x as never);
      const rawPrice = series.coordinateToPrice(y as never);
      if (logical === null || rawPrice === null || !Number.isFinite(Number(rawPrice))) return null;
      const index = Math.round(Number(logical));
      const snappedX = chart.timeScale().logicalToCoordinate(index as never);
      const price = snapPriceToTick(Number(rawPrice), priceTickSize);
      const snappedY = series.priceToCoordinate(price);
      if (snappedX === null || snappedY === null) return null;
      return {
        point: {
          index,
          timestamp: currentBars[index]?.timestamp ?? null,
          price,
          x: Number(snappedX),
          y: Number(snappedY),
        },
        paneWidth,
        paneHeight,
      };
    };

    const setCrosshairVisible = (visible: boolean) => {
      if (chartRef.current !== chart) return;
      chart.applyOptions({
        crosshair: {
          vertLine: { visible, labelVisible: visible },
          horzLine: { visible, labelVisible: visible },
        },
      });
    };
    const commitMeasurement = (next: MeasurementState | null) => {
      measurementRef.current = next;
      setMeasurement(next);
    };
    const clearMeasurement = (disarm: boolean) => {
      commitMeasurement(null);
      setCrosshairVisible(true);
      if (disarm) {
        measurementArmedRef.current = false;
        onMeasurementArmedChangeRef.current(false);
      }
      setChartCursor(disarm ? "" : "crosshair");
    };
    const resolvePoint = (point: MeasurementPoint) => {
      const currentBars = barsRef.current;
      const index = point.timestamp === null
        ? point.index
        : currentBars.findIndex((bar) => bar.timestamp === point.timestamp);
      if (point.timestamp !== null && index < 0) return null;
      const x = chart.timeScale().logicalToCoordinate(index as never);
      const y = series.priceToCoordinate(point.price);
      if (x === null || y === null) return null;
      return {
        ...point,
        index,
        timestamp: currentBars[index]?.timestamp ?? point.timestamp,
        x: Number(x),
        y: Number(y),
      };
    };
    const measurementState = (
      phase: MeasurementState["phase"],
      start: MeasurementPoint,
      end: MeasurementPoint,
      paneWidth: number,
      paneHeight: number,
    ): MeasurementState => ({
      phase,
      start,
      end,
      paneWidth,
      paneHeight,
      stats: calculateChartMeasurement({
        bars: barsRef.current,
        startIndex: start.index,
        endIndex: end.index,
        startPrice: start.price,
        endPrice: end.price,
        priceTickSize,
        displayIntervalSeconds,
      }),
    });

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !container.contains(event.target as Node)) return;
      if (drawingToolRef.current || drawingDraftRef.current || drawingPreviewRef.current) return;
      const current = measurementRef.current;
      if (!current && !event.shiftKey && !measurementArmedRef.current) return;
      const positioned = pointAt(event.clientX, event.clientY);
      if (!positioned) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setContextMenu(null);

      if (current?.phase === "fixed") {
        clearMeasurement(true);
        return;
      }
      if (current?.phase === "tracking") {
        const start = resolvePoint(current.start);
        if (!start) {
          clearMeasurement(true);
          return;
        }
        commitMeasurement(measurementState(
          "fixed",
          start,
          positioned.point,
          positioned.paneWidth,
          positioned.paneHeight,
        ));
        return;
      }

      if (!measurementArmedRef.current) {
        measurementArmedRef.current = true;
        onMeasurementArmedChangeRef.current(true);
      }
      setChartCursor("crosshair");
      setCrosshairVisible(false);
      commitMeasurement(measurementState(
        "tracking",
        positioned.point,
        positioned.point,
        positioned.paneWidth,
        positioned.paneHeight,
      ));
    };

    const move = (event: PointerEvent) => {
      const current = measurementRef.current;
      if (!current || current.phase !== "tracking" || !container.contains(event.target as Node)) return;
      const positioned = pointAt(event.clientX, event.clientY);
      if (!positioned) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const start = resolvePoint(current.start);
      if (!start) {
        clearMeasurement(true);
        return;
      }
      commitMeasurement(measurementState(
        "tracking",
        start,
        positioned.point,
        positioned.paneWidth,
        positioned.paneHeight,
      ));
    };

    const up = (event: PointerEvent) => {
      if (!measurementRef.current || !container.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!measurementRef.current && !measurementArmedRef.current)) return;
      clearMeasurement(true);
    };

    interaction.addEventListener("pointerdown", down, true);
    interaction.addEventListener("pointermove", move, true);
    interaction.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key);
    return () => {
      interaction.removeEventListener("pointerdown", down, true);
      interaction.removeEventListener("pointermove", move, true);
      interaction.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key);
      const hadMeasurement = measurementRef.current !== null;
      commitMeasurement(null);
      if (hadMeasurement) {
        measurementArmedRef.current = false;
        onMeasurementArmedChangeRef.current(false);
      }
      setCrosshairVisible(true);
      setChartCursor("");
    };
  }, [displayIntervalSeconds, hasVolume, priceTickSize, setChartCursor]);

  useEffect(() => {
    if (measurementArmed || !measurementRef.current) return;
    measurementRef.current = null;
    setMeasurement(null);
    chartRef.current?.applyOptions({
      crosshair: {
        vertLine: { visible: true, labelVisible: true },
        horzLine: { visible: true, labelVisible: true },
      },
    });
    setChartCursor("");
  }, [measurementArmed, setChartCursor]);

  useEffect(() => {
    if (!measurement) setChartCursor(measurementArmed ? "crosshair" : "");
  }, [measurement, measurementArmed, setChartCursor]);

  useEffect(() => {
    const container = containerRef.current;
    const interaction = interactionRef.current;
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!container || !interaction || !chart || !series) {
      setAbrTooltip(null);
      return;
    }

    const LONG_PRESS_MS = 350;
    const MOVE_TOLERANCE_PX = 6;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pointerId: number | null = null;
    let tracking = false;
    let start = { x: 0, y: 0 };
    let latestPointer = { x: 0, y: 0 };

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const tooltipAt = (clientX: number, clientY: number): AbrTooltipState | null => {
      const currentBars = barsRef.current;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const paneWidth = chart.timeScale().width();
      const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
      if (!currentBars.length || x < 0 || x > paneWidth || y < 0 || y > paneHeight) return null;
      const logical = chart.timeScale().coordinateToLogical(x as never);
      if (logical === null) return null;
      const index = Math.round(Number(logical));
      const bar = currentBars[index];
      if (!bar) return null;
      const tooltipWidth = 196;
      const tooltipHeight = abrEnabled ? 204 : 178;
      const preferredLeft = x + 14;
      const left = preferredLeft + tooltipWidth <= paneWidth - 8
        ? preferredLeft
        : Math.max(8, x - tooltipWidth - 14);
      const top = Math.max(8, Math.min(y + 12, Math.max(8, paneHeight - tooltipHeight - 8)));
      return {
        left,
        top,
        bar,
        value: abrEnabled ? abrValueAt(warmupBarsRef.current, barsRef.current, index, abrLengthRef.current) : null,
      };
    };
    const showAt = (clientX: number, clientY: number) => {
      setAbrTooltip(tooltipAt(clientX, clientY));
    };
    const nearOrderLine = (clientY: number) => {
      const y = clientY - container.getBoundingClientRect().top;
      return [...lineTargetsRef.current.values()].some((target) => {
        const coordinate = series.priceToCoordinate(target.price);
        return coordinate !== null && Math.abs(Number(coordinate) - y) <= 8;
      });
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !interaction.contains(event.target as Node)) return;
      if (drawingToolRef.current || drawingDraftRef.current || drawingPreviewRef.current
        || measurementArmedRef.current || measurementRef.current) return;
      const target = event.target as HTMLElement;
      if (target.closest("button,input,[data-context-menu],[data-order-ticket],[data-line-action]") || nearOrderLine(event.clientY)) return;
      pointerId = event.pointerId;
      start = { x: event.clientX, y: event.clientY };
      latestPointer = start;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (pointerId === null) return;
        tracking = true;
        chart.applyOptions({ handleScroll: false });
        setContextMenu(null);
        showAt(latestPointer.x, latestPointer.y);
      }, LONG_PRESS_MS);
    };
    const move = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      latestPointer = { x: event.clientX, y: event.clientY };
      if (!tracking) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) {
          clearTimer();
          pointerId = null;
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      showAt(event.clientX, event.clientY);
    };
    const finish = (event?: PointerEvent) => {
      if (event && pointerId !== event.pointerId) return;
      clearTimer();
      pointerId = null;
      if (!tracking) return;
      tracking = false;
      setAbrTooltip(null);
      chart.applyOptions({ handleScroll: true });
    };
    const blur = () => finish();

    interaction.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", blur);
    return () => {
      interaction.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("blur", blur);
      clearTimer();
      if (tracking) chart.applyOptions({ handleScroll: true });
      setAbrTooltip(null);
    };
  }, [abrEnabled, priceTickSize]);

  useEffect(() => {
    const container = containerRef.current; const interaction = interactionRef.current; const series = candleRef.current;
    if (!container || !interaction || !series) return;
    let dragging: { target: LineTarget; originalPrice: number; previewPrice: number } | null = null;
    const nearestLine = (y: number) => [...lineTargetsRef.current.values()]
      .filter((target) => target.kind !== "draft" || (!entryCheckOpen && !paperBusy))
      .map((target) => ({ target, coordinate: series.priceToCoordinate(target.price) }))
      .filter((item) => item.coordinate !== null)
      .sort((a, b) => Math.abs(Number(a.coordinate) - y) - Math.abs(Number(b.coordinate) - y))[0];
    const down = (event: PointerEvent) => {
      if (event.shiftKey || measurementArmedRef.current || drawingToolRef.current || drawingDraftRef.current || drawingPreviewRef.current) return;
      if ((event.target as HTMLElement | null)?.closest("button,input,[data-context-menu]")) return;
      const y = event.clientY - container.getBoundingClientRect().top;
      const dragKey = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-line-drag-key]")?.dataset.lineDragKey;
      const directTarget = dragKey ? lineTargetsRef.current.get(dragKey) : undefined;
      if (directTarget?.kind === "draft" && (entryCheckOpen || paperBusy)) return;
      const candidate = directTarget ? { target: directTarget, coordinate: series.priceToCoordinate(directTarget.price) } : nearestLine(y);
      if (!candidate || candidate.coordinate === null || (!directTarget && Math.abs(Number(candidate.coordinate) - y) > 8)) return;
      event.preventDefault(); setChartCursor("ns-resize"); setContextMenu(null);
      dragging = { target: candidate.target, originalPrice: candidate.target.price, previewPrice: candidate.target.price };
      interaction.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const y = event.clientY - container.getBoundingClientRect().top;
      const activeDrag = dragging;
      if (!activeDrag) {
        if (event.shiftKey || measurementArmedRef.current) {
          setChartCursor("crosshair");
          return;
        }
        const candidate = nearestLine(y);
        setChartCursor(candidate && Math.abs(Number(candidate.coordinate) - y) <= 8 ? "ns-resize" : "");
        return;
      }
      const price = snapPriceToTick(Number(series.coordinateToPrice((event.clientY - container.getBoundingClientRect().top) as never)), priceTickSize);
      if (!Number.isFinite(price) || price <= 0) return;
      const target = activeDrag.target;
      if (target.kind === "draft") {
        const field = target.field;
        setDraft((current) => {
          if (!current) return current;
          return moveDraftLine(current, field, price);
        });
      } else {
        activeDrag.previewPrice = price;
        const rLabel = target.rReference ? bracketPriceLineTitle(target.rReference, price, priceTickSize) : null;
        priceLinesRef.current.get(target.key)?.applyOptions({ price, ...(rLabel ? { title: rLabel } : {}) });
        setLineActions((current) => current.map((action) => action.key === target.key ? { ...action, price, y, ...(rLabel ? { label: rLabel } : {}) } : action));
      }
    };
    const finish = () => {
      if (!dragging) return;
      const value = dragging; dragging = null; setChartCursor("");
      if (value.target.kind === "order" && value.target.orderId && value.previewPrice !== value.originalPrice) {
        void onOrderPriceChangeRef.current(value.target.orderId, { [value.target.field]: value.previewPrice });
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragging) {
        if (dragging.target.kind === "order") priceLinesRef.current.get(dragging.target.key)?.applyOptions({ price: dragging.originalPrice });
        dragging = null; setChartCursor(""); syncLineActionCoordinates();
      }
    };
    const leave = () => { if (!dragging) setChartCursor(measurementArmedRef.current ? "crosshair" : ""); };
    interaction.addEventListener("pointerdown", down); interaction.addEventListener("pointermove", move);
    interaction.addEventListener("pointerup", finish); interaction.addEventListener("pointercancel", finish);
    interaction.addEventListener("pointerleave", leave); window.addEventListener("keydown", key);
    return () => {
      interaction.removeEventListener("pointerdown", down); interaction.removeEventListener("pointermove", move);
      interaction.removeEventListener("pointerup", finish); interaction.removeEventListener("pointercancel", finish);
      interaction.removeEventListener("pointerleave", leave); window.removeEventListener("keydown", key);
      setChartCursor("");
    };
  }, [entryCheckOpen, paperBusy, moveDraftLine, priceTickSize, setChartCursor, syncLineActionCoordinates]);

  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (drawingToolRef.current || drawingDraftRef.current || drawingPreviewRef.current) return;
    if ((event.target as HTMLElement).closest("[data-order-ticket],[data-context-menu],[data-line-action],[data-hidden-bars-notice]")) return;
    const series = candleRef.current;
    const root = event.currentTarget.getBoundingClientRect();
    const rawPrice = series?.coordinateToPrice((event.clientY - root.top) as never);
    const price = snapPriceToTick(Number(rawPrice), priceTickSize);
    const fallback = currentPrice ?? 0;
    const chart = chartRef.current;
    const x = event.clientX - root.left, y = event.clientY - root.top;
    const insidePane = chart && x >= 0 && x <= chart.timeScale().width() && y >= 0 && y <= (chart.panes()[0]?.getHeight() ?? 0);
    const logical = insidePane ? chart.timeScale().coordinateToLogical(x as never) : null;
    const hideAfter = chartHideAfterTarget(barsRef.current, logical === null ? null : Number(logical), displayIntervalSeconds, displaySession);
    if (readOnly && !hideAfter) return;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX - root.left, root.width - 228)),
      y: Math.max(8, Math.min(event.clientY - root.top, root.height - 264)),
      price: Number.isFinite(price) && price > 0 ? price : fallback,
      rewindTarget: onRewindToBar && rewindRange ? chartRewindTarget(barsRef.current, logical === null ? null : Number(logical), rewindRange) : null,
      hideAfter,
    });
  }

  function resetChartView() {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().setVisibleLogicalRange(defaultReplayLogicalRange(chart.timeScale().width(), bars.length));
    candleRef.current?.priceScale().applyOptions({ autoScale: true });
    volumeRef.current?.priceScale().applyOptions({ autoScale: true });
    setContextMenu(null);
    requestAnimationFrame(syncLineActionCoordinates);
    syncDrawingPrimitive();
  }

  function createDraft(side: PaperSide, type: "LIMIT" | "STOP") {
    if (entryCheckOpen || paperBusy || !paperSnapshot || !latest || !contextMenu || contextMenu.price <= 0) return;
    const rawDistance = latest.high > latest.low && Number.isFinite(latest.high - latest.low)
      ? latest.high - latest.low
      : contextMenu.price * 0.01;
    const distance = Math.max(priceTickSize, Math.round(Math.min(rawDistance, contextMenu.price * 0.99) / priceTickSize) * priceTickSize);
    const riskAmount = defaultRiskAmount ?? paperSnapshot.session.initialCapital * 0.01;
    const stopLoss = snapPriceToTick(side === "BUY" ? contextMenu.price - distance : contextMenu.price + distance, priceTickSize);
    const targetR = defaultTargetR > 0 ? defaultTargetR : 2;
    setDraft({
      id: createUuid(),
      side, type, entryPrice: contextMenu.price, stopLoss,
      takeProfit: snapPriceToTick(targetPriceForR(side, contextMenu.price, stopLoss, targetR), priceTickSize),
      riskAmount, targetR, tpMode: "LINKED",
    });
    setOrderTicketPosition(null);
    setDraftError(null); setDefaultSaved(false); setContextMenu(null);
  }

  function setDraftPrice(field: "entryPrice" | "stopLoss" | "takeProfit", value: number) {
    value = snapPriceToTick(value, priceTickSize);
    setDraft((current) => {
      if (!current) return current;
      if (field === "entryPrice") return {
        ...current,
        entryPrice: value,
        type: currentPrice === null ? current.type : orderTypeForEntry(current.side, value, currentPrice),
        takeProfit: current.tpMode === "LINKED" ? snapPriceToTick(targetPriceForR(current.side, value, current.stopLoss, current.targetR), priceTickSize) : current.takeProfit,
      };
      if (field === "stopLoss") return {
        ...current, stopLoss: value,
        takeProfit: current.tpMode === "LINKED" ? snapPriceToTick(targetPriceForR(current.side, current.entryPrice, value, current.targetR), priceTickSize) : current.takeProfit,
      };
      return { ...current, takeProfit: value, tpMode: "FREE" };
    });
    setDraftError(null);
  }

  function setTargetR(value: number) {
    setDraft((current) => current ? {
      ...current, targetR: value, tpMode: "LINKED" as const,
      takeProfit: snapPriceToTick(targetPriceForR(current.side, current.entryPrice, current.stopLoss, value), priceTickSize),
    } : current);
    setDraftError(null);
  }

  async function saveDefaults() {
    if (!draft || draft.riskAmount <= 0 || draft.targetR <= 0) return;
    setDefaultRiskAmount(draft.riskAmount); setDefaultTargetR(draft.targetR);
    try {
      window.localStorage.setItem(`market-replay-risk-settings-v2:${replaySession?.id ?? datasetId}`, JSON.stringify({ riskAmount: draft.riskAmount, targetR: draft.targetR }));
    } catch {
      // Local storage is optional; the current draft remains usable.
    }
    if (replaySession) {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await fetch(`/api/replay-sessions/${encodeURIComponent(replaySession.id)}`, { cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
          const saved = await fetch(`/api/replay-sessions/${encodeURIComponent(replaySession.id)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedVersion: data.session.version, riskPreferences: { riskAmount: draft.riskAmount, targetR: draft.targetR } }),
          });
          if (saved.status === 409 && attempt < 2) continue;
          if (!saved.ok) throw new Error((await saved.json()).error ?? copy.replaySessions.requestFailed);
          break;
        }
      } catch (error) { setDraftError(error instanceof Error ? error.message : copy.replaySessions.requestFailed); return; }
    }
    setDefaultSaved(true);
  }

  async function submitDraft() {
    if (entryCheckOpen || paperBusy || !draft || !draftSizing?.ok) return;
    const success = await onSubmitOrder({
      side: draft.side, type: draft.type, quantity: draftSizing.value.quantity,
      riskAmount: draft.riskAmount, price: draft.entryPrice,
      stopLoss: draft.stopLoss, takeProfit: draft.takeProfit,
    }, draft.id);
    if (success === true || success === "SUCCESS") {
      setDraft(null); setDraftError(null); setOrderTicketPosition(null);
    } else if (success !== "CANCELLED") setDraftError(copy.paperTrading.draftSubmitFailed);
  }

  const contextEntryOrderTypes = currentPrice !== null && contextMenu !== null
    ? {
      buy: orderTypeForEntry("BUY", contextMenu.price, currentPrice),
      sell: orderTypeForEntry("SELL", contextMenu.price, currentPrice),
    }
    : null;
  const measurementColor = measurement
    ? measurement.stats.priceChange > 0 ? "#2962ff" : measurement.stats.priceChange < 0 ? "#f23645" : "#64748b"
    : "#64748b";
  const measurementGeometry = measurement
    ? calculateChartMeasurementGeometry({
      startX: measurement.start.x,
      startY: measurement.start.y,
      endX: measurement.end.x,
      endY: measurement.end.y,
    })
    : null;
  const measurementDuration = measurement
    ? copy.marketReplay.measurementDuration(measurementDurationParts(measurement.stats.elapsedMilliseconds))
    : "";
  const measurementLabelLeft = measurement
    ? measurement.paneWidth >= 192
      ? Math.max(96, Math.min(measurement.end.x, measurement.paneWidth - 96))
      : measurement.paneWidth / 2
    : 0;
  const measurementLabelTop = (() => {
    if (!measurement) return 0;
    const labelHeight = measurement.stats.volume === null ? 58 : 76;
    const gap = 10;
    let top = measurement.stats.priceChange >= 0
      ? measurement.end.y - labelHeight - gap
      : measurement.end.y + gap;
    if (top < 8) top = measurement.end.y + gap;
    if (top + labelHeight > measurement.paneHeight - 8) top = measurement.end.y - labelHeight - gap;
    return Math.max(8, Math.min(top, Math.max(8, measurement.paneHeight - labelHeight - 8)));
  })();
  return (
    <div
      ref={interactionRef}
      className="relative h-full min-h-0 select-none"
      onContextMenu={openContextMenu}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (!(event.target as HTMLElement).closest("[data-context-menu]")) setContextMenu(null);
      }}
    >
      <div
        ref={containerRef}
        className="h-full min-h-[240px] w-full overflow-hidden bg-white"
        aria-label={copy.marketReplay.chartAriaLabel}
        data-bar-count={bars.length}
        data-visible-bar-count={visibleBars.length}
      />

      {hiddenAfter ? <Alert data-hidden-bars-notice role="status" aria-live="polite"
        className="absolute bottom-3 left-3 z-30 flex w-auto max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="flex items-center gap-2 font-medium text-slate-700"><EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.marketReplay.subsequentBarsHidden}</span>
        <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-8" data-testid="restore-subsequent-bars" aria-label={copy.marketReplay.restoreSubsequentBars}
          onClick={() => { setHiddenBoundary(null); setAbrTooltip(null); }}>{copy.marketReplay.restoreSubsequentBars}</Button>
      </Alert> : null}

      {tradeAnnotationsVisible && tradeAnnotationsTruncated ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-md bg-amber-50/95 px-2 py-1 text-[11px] text-amber-800 shadow-sm backdrop-blur">
          {copy.paperTrading.tradeAnnotationLimit(100)}
        </div>
      ) : null}

      {abrTooltip ? (
        <div
          data-testid="abr-bar-tooltip"
          className="pointer-events-none absolute z-30 w-[196px] rounded-md border border-slate-200 bg-white/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur"
          style={{ left: abrTooltip.left, top: abrTooltip.top }}
        >
          <div className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-1.5">
            {abrEnabled ? (
              <>
                <span className="font-medium text-slate-600">{copy.marketReplay.abrName(abrLength)}</span>
                <span className="font-mono font-semibold text-slate-950">{formatAbrValue(abrTooltip.value, priceTickSize)}</span>
              </>
            ) : null}
            <span className="text-slate-600">{copy.marketReplay.abrOpen}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.open, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.abrHigh}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.high, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.abrLow}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.low, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.abrClose}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.close, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.barEmission.phaseLabel}</span>
            <span className="text-right text-slate-950">{copy.marketReplay.barEmission.phase[aggregatePhase(abrTooltip.bar)]}</span>
            <span className="text-slate-600">{copy.marketReplay.barEmission.qualityLabel}</span>
            <span className={aggregateHasGap(abrTooltip.bar) ? "text-right text-amber-800" : "text-right text-slate-950"}>{copy.marketReplay.barEmission.quality[abrTooltip.bar.quality ?? (aggregateHasGap(abrTooltip.bar) ? "GAP" : "UNKNOWN")]}</span>
            <span className="text-slate-600">{copy.marketReplay.barEmission.records}</span>
            <span className="text-right font-mono tabular-nums text-slate-950">{formatInteger(abrTooltip.bar.sourceCount)} / {formatInteger(abrTooltip.bar.expectedCount)}</span>
          </div>
        </div>
      ) : null}

      {measurement && measurementGeometry ? (
        <div
          data-testid="chart-measurement"
          className="pointer-events-none absolute left-0 top-0 z-10 overflow-hidden"
          style={{ width: measurement.paneWidth, height: measurement.paneHeight }}
        >
          <svg
            aria-hidden="true"
            className="absolute inset-0"
            width={measurement.paneWidth}
            height={measurement.paneHeight}
            viewBox={`0 0 ${measurement.paneWidth} ${measurement.paneHeight}`}
          >
            <rect
              x={measurementGeometry.left}
              y={measurementGeometry.top}
              width={measurementGeometry.width}
              height={measurementGeometry.height}
              fill={measurementColor}
              fillOpacity="0.16"
            />
            <line
              x1={measurementGeometry.left}
              y1={measurementGeometry.middleY}
              x2={measurementGeometry.right}
              y2={measurementGeometry.middleY}
              stroke={measurementColor}
              strokeWidth="1.25"
              opacity="0.9"
            />
            <line
              x1={measurementGeometry.middleX}
              y1={measurementGeometry.top}
              x2={measurementGeometry.middleX}
              y2={measurementGeometry.bottom}
              stroke={measurementColor}
              strokeWidth="1.25"
              opacity="0.9"
            />
          </svg>
          <div
            className="absolute min-w-[176px] -translate-x-1/2 rounded-md px-3 py-2 text-center text-xs font-medium leading-5 text-white shadow-lg"
            style={{ left: measurementLabelLeft, top: measurementLabelTop, backgroundColor: measurementColor }}
          >
            <div className="font-mono font-semibold">
              {formatPriceForTick(measurement.stats.priceChange, priceTickSize)}
              {" "}({measurement.stats.percentageChange.toFixed(2)}%){" "}
              {measurement.stats.tickChange.toLocaleString("zh-CN")}
            </div>
            <div>{copy.marketReplay.measurementSpan(measurement.stats.barCount, measurementDuration)}</div>
            {measurement.stats.volume !== null ? (
              <div>{copy.marketReplay.measurementVolume(compactVolume(measurement.stats.volume))}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {lineActions.map((action) => (
        <div
          key={action.key}
          data-line-action
          data-testid={`line-action-${action.kind}-${action.key}`}
          className="absolute right-16 z-20 flex max-w-[360px] -translate-y-1/2 items-center overflow-hidden rounded-md border bg-white/95 text-[11px] shadow-sm backdrop-blur"
          style={{ top: action.y, borderColor: `${action.color}66`, color: action.color }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span
            data-line-drag-key={action.kind === "cancel" ? action.key : undefined}
            className={action.kind === "cancel" ? "cursor-ns-resize touch-none truncate px-2 py-1 font-medium" : "truncate px-2 py-1 font-medium"}
            title={action.kind === "cancel" ? copy.paperTrading.dragHint : undefined}
          >
            {action.label}
          </span>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 border-l px-2 py-1 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: `${action.color}44` }}
            disabled={paperBusy || (action.kind === "close" && hasPendingClose)}
            aria-label={action.kind === "cancel" ? copy.paperTrading.cancelOrderFromLine(action.label) : copy.paperTrading.oneClickClose}
            onClick={() => action.kind === "cancel" && action.orderId ? void onCancelOrder(action.orderId) : void onClosePosition()}
          >
            {action.kind === "cancel" ? <X className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
            {action.kind === "cancel" ? copy.paperTrading.cancelFromLine : hasPendingClose ? copy.paperTrading.closePending : copy.paperTrading.oneClickClose}
          </button>
        </div>
      ))}

      {latest && (aggregatePhase(latest) === "FORMING" || aggregateHasGap(latest)) ? (
        <div className={`pointer-events-none absolute left-3 top-3 rounded-md px-2 py-1 text-xs shadow-sm ${aggregateHasGap(latest) ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-800"}`}>
          {aggregateHasGap(latest) ? copy.marketReplay.incompleteBar(latest.sourceCount, latest.expectedCount) : copy.marketReplay.formingBar(latest.sourceCount, latest.expectedCount)}
        </div>
      ) : null}

      {!draft && paperSnapshot && latest ? <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm backdrop-blur">{copy.paperTrading.rightClickHint}</div> : null}

      {contextMenu ? (
        <div ref={contextMenuRef} data-context-menu role="menu" className="absolute z-40 max-h-[calc(100%-1rem)] w-[220px] max-w-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {!readOnly ? (
            <button type="button" role="menuitem" data-testid="context-reset-chart-view" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={resetChartView}>
              <RotateCcw className="h-4 w-4" />
              {copy.marketReplay.resetChartView}
            </button>
          ) : null}
          {contextMenu.hideAfter ? <Button type="button" role="menuitem" variant="ghost" data-testid="context-hide-subsequent-bars"
            className="w-full justify-start px-2 text-left font-medium text-slate-700"
            onClick={() => { const target = contextMenu.hideAfter; if (target) setHiddenBoundary({ scope: visibilityScope, target }); setContextMenu(null); setAbrTooltip(null); }}>
            <EyeOff className="h-4 w-4" aria-hidden="true" />{copy.marketReplay.hideSubsequentBars}
          </Button> : null}
          {!readOnly ? <>
          <div className="mb-1 border-b pb-1">
            {onToggleGrid ? (
              <Button
                type="button"
                role="menuitem"
                variant="ghost"
                className="w-full justify-start px-2 text-left font-medium text-slate-700"
                onClick={() => { onToggleGrid(); setContextMenu(null); }}
              >
                <Grid2X2 className="h-4 w-4" aria-hidden="true" />
                {gridVisible ? copy.marketReplay.hideBackgroundGrid : copy.marketReplay.showBackgroundGrid}
              </Button>
            ) : null}
          </div>
          {onRewindToBar && contextMenu.rewindTarget ? <div className="mb-1 border-b pb-1">
            <Button type="button" role="menuitem" variant="ghost" data-testid="context-rewind-to-bar" disabled={paperBusy || entryCheckOpen}
              className="w-full justify-start px-2 text-left text-slate-700" title={paperBusy ? copy.replaySessions.rewindWait : undefined}
              onClick={() => { const target = contextMenu.rewindTarget; setContextMenu(null); if (target) onRewindToBar(target); }}>
              <Undo2 className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.rewindToBar}
            </Button>
            <p className="px-2 pb-1 text-xs tabular-nums text-slate-600">{copy.replaySessions.rewindSelectedBar} · {formatUtcOffset(displayUtcOffsetMinutes)}<br />{formatUtcDateTime(contextMenu.rewindTarget.timestamp, displayUtcOffsetMinutes)}</p>
            {paperBusy ? <p className="px-2 pb-1 text-xs text-slate-600">{copy.replaySessions.rewindWait}</p> : null}
          </div> : null}
          <div className="border-b px-2 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{copy.paperTrading.contextPrice}</p>
            <p className="font-mono text-sm font-semibold text-slate-900">{formatPriceForTick(contextMenu.price, priceTickSize)}</p>
          </div>
          {!paperSnapshot ? (
            <div className="space-y-2 p-2">
              <p className="text-xs leading-5 text-slate-600">{copy.paperTrading.contextNoAccount}</p>
              <Button type="button" size="sm" className="w-full" onClick={() => { setContextMenu(null); onOpenPaperAccount(); }}>{copy.paperTrading.openAccountSettings}</Button>
            </div>
          ) : !latest || currentPrice === null ? (
            <div className="flex gap-2 p-2 text-xs leading-5 text-amber-800"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{copy.paperTrading.contextNoBar}</div>
          ) : contextEntryOrderTypes ? (
            <fieldset disabled={entryCheckOpen || paperBusy} className="space-y-0.5 pt-1">
              {contextEntryOrderTypes.buy === "LIMIT" ? <button type="button" role="menuitem" data-testid="context-buy-limit" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => createDraft("BUY", "LIMIT")}>{copy.paperTrading.buyLimit}</button> : null}
              {contextEntryOrderTypes.sell === "LIMIT" ? <button type="button" role="menuitem" data-testid="context-sell-limit" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-orange-700 hover:bg-orange-50" onClick={() => createDraft("SELL", "LIMIT")}>{copy.paperTrading.sellLimit}</button> : null}
              {contextEntryOrderTypes.sell === "STOP" ? <button type="button" role="menuitem" data-testid="context-sell-stop" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50" onClick={() => createDraft("SELL", "STOP")}>{copy.paperTrading.sellStop}</button> : null}
              {contextEntryOrderTypes.buy === "STOP" ? <button type="button" role="menuitem" data-testid="context-buy-stop" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => createDraft("BUY", "STOP")}>{copy.paperTrading.buyStop}</button> : null}
            </fieldset>
          ) : null}
          </> : null}
        </div>
      ) : null}

      {draft && paperSnapshot ? (
        <div
          ref={orderTicketRef}
          data-order-ticket
          data-testid="risk-order-ticket"
          className={`absolute z-30 w-[292px] rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur ${orderTicketPosition ? "" : "right-16 top-3"}`}
          style={orderTicketPosition ? { left: orderTicketPosition.x, top: orderTicketPosition.y } : undefined}
        >
          <div
            className="flex touch-none select-none items-start gap-2 border-b px-3 py-2.5 cursor-move"
            title={copy.paperTrading.dragOrderTicket}
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as HTMLElement).closest("button,input")) return;
              const ticket = orderTicketRef.current;
              if (!ticket) return;
              const rect = ticket.getBoundingClientRect();
              orderTicketDragRef.current = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const drag = orderTicketDragRef.current;
              const interaction = interactionRef.current;
              const ticket = orderTicketRef.current;
              if (!drag || drag.pointerId !== event.pointerId || !interaction || !ticket) return;
              const interactionRect = interaction.getBoundingClientRect();
              const ticketRect = ticket.getBoundingClientRect();
              setOrderTicketPosition({
                x: Math.min(Math.max(8, event.clientX - interactionRect.left - drag.offsetX), Math.max(8, interactionRect.width - ticketRect.width - 8)),
                y: Math.min(Math.max(8, event.clientY - interactionRect.top - drag.offsetY), Math.max(8, interactionRect.height - ticketRect.height - 8)),
              });
            }}
            onPointerUp={(event) => {
              if (orderTicketDragRef.current?.pointerId !== event.pointerId) return;
              orderTicketDragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { orderTicketDragRef.current = null; }}
          >
            <GripHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${draft.side === "BUY" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{draft.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell}</span>
                <span className="text-sm font-semibold text-slate-950">{copy.paperTrading.draftTitle}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{copy.paperTrading.draftDescription}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" disabled={entryCheckOpen || paperBusy} className="-mr-1 -mt-1 h-7 w-7 shrink-0 cursor-pointer" aria-label={copy.paperTrading.cancelDraft} onClick={() => { setDraft(null); setDraftError(null); setOrderTicketPosition(null); }}><X className="h-4 w-4" /></Button>
          </div>
          <fieldset disabled={entryCheckOpen || paperBusy} className="space-y-3 p-3">
            <div className="grid grid-cols-3 gap-2">
              <div><Label htmlFor="draft-entry" className="text-[10px] text-blue-700">ENTRY · {orderTypeLabel(draft.type)}</Label><Input id="draft-entry" data-testid="draft-entry" type="number" step={priceTickSize} className="mt-1 h-8 px-2 font-mono text-xs" value={draft.entryPrice} onChange={(event) => setDraftPrice("entryPrice", Number(event.target.value))} /></div>
              <div><Label htmlFor="draft-sl" className="text-[10px] text-red-700">SL</Label><Input id="draft-sl" data-testid="draft-sl" type="number" step={priceTickSize} className="mt-1 h-8 px-2 font-mono text-xs" value={draft.stopLoss} onChange={(event) => setDraftPrice("stopLoss", Number(event.target.value))} /></div>
              <div><Label htmlFor="draft-tp" className="text-[10px] text-emerald-700">TP</Label><Input id="draft-tp" data-testid="draft-tp" type="number" step={priceTickSize} className="mt-1 h-8 px-2 font-mono text-xs" value={draft.takeProfit} onChange={(event) => setDraftPrice("takeProfit", Number(event.target.value))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="draft-risk" className="text-[11px]">{copy.paperTrading.fixedRiskAmount}</Label><Input id="draft-risk" data-testid="draft-risk" type="number" min="0.01" step="any" className="mt-1 h-8" value={draft.riskAmount} onChange={(event) => { setDraft((current) => current ? { ...current, riskAmount: Number(event.target.value) } : current); setDraftError(null); setDefaultSaved(false); }} /></div>
              <div><Label htmlFor="draft-target-r" className="text-[11px]">{copy.paperTrading.targetR}</Label><Input id="draft-target-r" data-testid="draft-target-r" type="number" min="0.01" step="0.1" className="mt-1 h-8" value={draft.targetR} onChange={(event) => { setTargetR(Number(event.target.value)); setDefaultSaved(false); }} /></div>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className={`inline-flex items-center gap-1 ${draft.tpMode === "LINKED" ? "text-blue-700" : "text-slate-500"}`}><Link2 className="h-3 w-3" />{draft.tpMode === "LINKED" ? copy.paperTrading.linkedTarget : copy.paperTrading.freeTarget}</span>
              <div className="flex items-center gap-1">
                {draft.tpMode === "FREE" ? <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => setTargetR(draft.targetR)}>{copy.paperTrading.restoreTargetR}</button> : null}
                <button type="button" className="font-medium text-slate-500 hover:text-slate-900" onClick={saveDefaults}>{defaultSaved ? copy.paperTrading.defaultSaved : copy.paperTrading.saveAsDefault}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">
              <span className="text-slate-500">{copy.paperTrading.estimatedQuantity}</span><strong data-testid="draft-quantity" className="text-right font-mono font-semibold text-slate-900">{draftSizing?.ok ? number(draftSizing.value.quantity) : "—"}</strong>
              <span className="text-slate-500">{copy.paperTrading.estimatedLoss}</span><strong className="text-right font-medium text-red-700">{draftSizing?.ok ? `-${money(draftSizing.value.projectedLoss, paperSnapshot.session.currency)}` : "—"}</strong>
              <span className="text-slate-500">{copy.paperTrading.estimatedProfit}</span><strong className="text-right font-medium text-emerald-700">{draftSizing?.ok && draftSizing.value.projectedProfit !== null ? `+${money(draftSizing.value.projectedProfit, paperSnapshot.session.currency)}` : "—"}</strong>
              <span className="text-slate-500">{copy.paperTrading.netRewardRisk}</span><strong data-testid="draft-ratio" className="text-right font-mono font-semibold text-slate-900">{draftSizing?.ok && draftSizing.value.rewardRiskRatio !== null ? `${draftSizing.value.rewardRiskRatio.toFixed(2)}R` : "—"}</strong>
            </div>
            {!draftSizing?.ok ? <p className="text-xs text-red-600">{draftSizing ? sizingErrorText(draftSizing.error) : copy.paperTrading.invalidPrice}</p> : null}
            {draftError || paperError ? <p className="text-xs text-red-600">{draftError ?? paperError}</p> : null}
            <div className="grid grid-cols-[1fr_1.6fr] gap-2">
              <Button type="button" variant="outline" size="sm" disabled={paperBusy} onClick={() => { setDraft(null); setDraftError(null); setOrderTicketPosition(null); }}>{copy.paperTrading.cancelDraft}</Button>
              <Button type="button" size="sm" data-testid="confirm-risk-order" disabled={paperBusy || !draftSizing?.ok} onClick={() => void submitDraft()}>{paperBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{paperBusy ? copy.paperTrading.submitting : paperSnapshot.session.trainingGate?.active && !isClosingOrder(paperSnapshot.session.netQuantity, draft.side, draftSizing?.ok ? draftSizing.value.quantity : 0) ? copy.trainingGate.selectStrategy : copy.paperTrading.confirmDraft}</Button>
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
