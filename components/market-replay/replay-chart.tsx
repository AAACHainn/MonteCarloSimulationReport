"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link2, Loader2, LogOut, RotateCcw, ShieldAlert, X } from "lucide-react";
import {
  CandlestickSeries, ColorType, createChart, CrosshairMode,
  HistogramSeries, type IChartApi, type IPriceLine, type ISeriesApi,
  type Time, TickMarkType, type UTCTimestamp,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AggregatedMarketBarData,
  BarCountIndicatorConfig,
  DisplaySession,
  EmaIndicatorConfig,
  TradingSessionConfig,
} from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
import { calculateAbrSeries } from "@/lib/market-replay/abr";
import {
  defaultReplayLogicalRange,
  rangeAfterNewReplayBar,
  rangeAfterWindowReplacement,
} from "@/lib/market-replay/chart-range";
import {
  candlestickSeriesStyleOptions,
  type CandlestickStyle,
} from "@/lib/market-replay/candlestick-style";
import {
  calculateChartMeasurement,
  measurementDurationParts,
  type ChartMeasurementStats,
} from "@/lib/market-replay/chart-measurement";
import {
  anchorForLogicalIndex,
  DRAWING_TYPE_FIB_RETRACEMENT,
  DRAWING_TYPE_TREND_LINE,
  snapScreenPointTo45,
  type DrawingAnchor,
  type DrawingTool,
  type FibonacciRetracementDrawing,
  type FibonacciRetracementStyle,
  type MarketDrawing,
  type TrendLineDrawing,
  type TrendLineGeometry,
} from "@/lib/market-replay/chart-drawings";
import { TrendLinePrimitive } from "@/lib/market-replay/trend-line-primitive";
import { FibonacciRetracementPrimitive } from "@/lib/market-replay/fibonacci-retracement-primitive";
import { formatUtcDateTime, utcDateParts } from "@/lib/market-replay/display-timezone";
import { formatPriceForTick, priceDecimalsForTick, snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { ReplayTradeAnnotationPrimitive } from "@/lib/market-replay/trade-annotation-primitive";
import { BarCountPrimitive } from "@/lib/market-replay/bar-count-primitive";
import {
  calculateRiskSizing,
  orderTypeForEntry,
  targetPriceForR,
  type RiskSizingError,
} from "@/lib/paper-trading/risk-sizing";
import {
  createBracketRReference,
  formatRMultiple,
  protectiveOrderRReference,
  rMultipleAtPrice,
  type PriceRReference,
} from "@/lib/paper-trading/line-r-multiple";
import type { PaperSessionSnapshot, PaperSide, ReplayTradeAnnotationData } from "@/lib/paper-trading/types";
import { useReplayChartEma } from "./use-replay-chart-ema";

type DraftOrder = {
  side: PaperSide;
  type: "LIMIT" | "STOP";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  targetR: number;
  tpMode: "LINKED" | "FREE";
};

type ContextMenuState = { x: number; y: number; price: number };
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

function chartTime(timestamp: string) {
  return Math.floor(new Date(timestamp).getTime() / 1_000) as UTCTimestamp;
}

function formatChartTick(time: Time, tickMarkType: TickMarkType, offsetMinutes: number) {
  if (typeof time !== "number") return String(time);
  const parts = utcDateParts(time * 1_000, offsetMinutes);
  if (tickMarkType === TickMarkType.Year) return parts.year;
  if (tickMarkType === TickMarkType.Month) return `${parts.year}/${parts.month}`;
  if (tickMarkType === TickMarkType.DayOfMonth) return `${parts.month}/${parts.day}`;
  if (tickMarkType === TickMarkType.TimeWithSeconds) return `${parts.hour}:${parts.minute}:${parts.second}`;
  return `${parts.hour}:${parts.minute}`;
}

function candle(bar: AggregatedMarketBarData) {
  const incomplete = bar.status === "INCOMPLETE";
  return {
    time: chartTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    ...(incomplete ? { borderColor: "#f59e0b", wickColor: "#f59e0b" } : {}),
  };
}

function volume(bar: AggregatedMarketBarData) {
  return {
    time: chartTime(bar.timestamp), value: bar.volume ?? 0,
    color: bar.status === "INCOMPLETE" ? "rgba(245,158,11,.5)" : bar.close >= bar.open ? "rgba(22,163,74,.45)" : "rgba(220,38,38,.45)",
  };
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

export function ReplayChart({
  datasetId, priceTickSize, bars, warmupBars, displayUtcOffsetMinutes, displayIntervalSeconds, measurementArmed,
  candlestickStyle,
  onMeasurementArmedChange, drawingTool, onDrawingToolChange, trendLineDraftStyle, fibonacciDraftStyle, drawings, selectedDrawingId,
  onSelectedDrawingIdChange, onCreateDrawing, onUpdateDrawing, onDeleteDrawing,
  onOpenDrawingStyle, emaEnabled, emaIndicators, abrEnabled, abrLength, volumeVisible,
  displaySession, barCountSession, barCountConfig, paperSnapshot,
  tradeAnnotations, tradeAnnotationsTruncated, focusSequence = null,
  paperBusy, paperError, onSubmitOrder, onOrderPriceChange,
  onCancelOrder, onClosePosition, onDraftActiveChange, onOpenPaperAccount,
}: {
  datasetId: string;
  priceTickSize: number;
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  displayUtcOffsetMinutes: number;
  displayIntervalSeconds: number;
  measurementArmed: boolean;
  candlestickStyle: CandlestickStyle;
  onMeasurementArmedChange: (armed: boolean) => void;
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
  displaySession: DisplaySession;
  barCountSession: TradingSessionConfig;
  barCountConfig: BarCountIndicatorConfig;
  paperSnapshot: PaperSessionSnapshot | null;
  tradeAnnotations: ReplayTradeAnnotationData[];
  tradeAnnotationsTruncated: boolean;
  focusSequence?: number | null;
  paperBusy: boolean;
  paperError: string | null;
  onSubmitOrder: (order: { side: PaperSide; type: "LIMIT" | "STOP"; quantity: number; riskAmount: number; price: number; stopLoss: number; takeProfit: number }) => Promise<boolean>;
  onOrderPriceChange: (orderId: string, update: OrderUpdate) => Promise<boolean>;
  onCancelOrder: (orderId: string) => Promise<boolean>;
  onClosePosition: () => Promise<boolean>;
  onDraftActiveChange: (active: boolean) => void;
  onOpenPaperAccount: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef(new Map<string, IPriceLine>());
  const lineTargetsRef = useRef(new Map<string, LineTarget>());
  const tradeAnnotationPrimitiveRef = useRef<ReplayTradeAnnotationPrimitive | null>(null);
  const barCountPrimitiveRef = useRef<BarCountPrimitive | null>(null);
  const trendLinePrimitiveRef = useRef<TrendLinePrimitive | null>(null);
  const fibonacciPrimitiveRef = useRef<FibonacciRetracementPrimitive | null>(null);
  const lastDataRef = useRef<AggregatedMarketBarData[]>([]);
  const barsRef = useRef(bars);
  const tradeAnnotationsRef = useRef(tradeAnnotations);
  tradeAnnotationsRef.current = tradeAnnotations;
  const candlestickStyleRef = useRef(candlestickStyle);
  candlestickStyleRef.current = candlestickStyle;
  const priceTickSizeRef = useRef(priceTickSize);
  priceTickSizeRef.current = priceTickSize;
  const trendLineDraftStyleRef = useRef(trendLineDraftStyle);
  trendLineDraftStyleRef.current = trendLineDraftStyle;
  const fibonacciDraftStyleRef = useRef(fibonacciDraftStyle);
  fibonacciDraftStyleRef.current = fibonacciDraftStyle;
  const measurementArmedRef = useRef(measurementArmed);
  const onMeasurementArmedChangeRef = useRef(onMeasurementArmedChange);
  const drawingToolRef = useRef(drawingTool);
  const drawingsRef = useRef(drawings);
  const selectedDrawingIdRef = useRef(selectedDrawingId);
  const onDrawingToolChangeRef = useRef(onDrawingToolChange);
  const onSelectedDrawingIdChangeRef = useRef(onSelectedDrawingIdChange);
  const onCreateDrawingRef = useRef(onCreateDrawing);
  const onUpdateDrawingRef = useRef(onUpdateDrawing);
  const onDeleteDrawingRef = useRef(onDeleteDrawing);
  const onOpenDrawingStyleRef = useRef(onOpenDrawingStyle);
  const displayIntervalSecondsRef = useRef(displayIntervalSeconds);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [abrTooltip, setAbrTooltip] = useState<AbrTooltipState | null>(null);
  const [measurement, setMeasurement] = useState<MeasurementState | null>(null);
  const measurementRef = useRef<MeasurementState | null>(null);
  const drawingDraftRef = useRef<DrawingDraft | null>(null);
  const drawingDraftCoordinateRef = useRef<DrawingSegmentCoordinate | null>(null);
  const drawingPreviewRef = useRef<{ id: string; geometry: TrendLineGeometry } | null>(null);
  const [draft, setDraft] = useState<DraftOrder | null>(null);
  const [defaultRiskAmount, setDefaultRiskAmount] = useState<number | null>(null);
  const [defaultTargetR, setDefaultTargetR] = useState(2);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [lineActions, setLineActions] = useState<LineAction[]>([]);
  const hasVolume = useMemo(() => [...warmupBars, ...bars].some((bar) => bar.volume !== null), [bars, warmupBars]);
  const abrValues = useMemo(() => {
    const values = Array<number | null>(bars.length).fill(null);
    if (!abrEnabled || bars.length === 0) return values;
    const allBars = [...warmupBars, ...bars];
    const result = calculateAbrSeries(allBars, abrLength, allBars.length - 1, warmupBars.length);
    for (const point of result.points) {
      const visibleIndex = point.sequence - warmupBars.length;
      if (visibleIndex >= 0 && visibleIndex < values.length) values[visibleIndex] = point.value;
    }
    return values;
  }, [abrEnabled, abrLength, bars, warmupBars]);
  const abrValuesRef = useRef(abrValues);
  abrValuesRef.current = abrValues;
  const latest = bars.at(-1);
  const currentPrice = latest?.close ?? null;
  const currentPriceRef = useRef(currentPrice);
  const displayUtcOffsetRef = useRef(displayUtcOffsetMinutes);
  const onOrderPriceChangeRef = useRef(onOrderPriceChange);
  const paperSessionId = paperSnapshot?.session.id ?? null;
  const paperInitialCapital = paperSnapshot?.session.initialCapital ?? null;
  const hasPendingClose = paperSnapshot?.activeOrders.some((order) => order.reduceOnly && !order.isProtective) ?? false;

  useEffect(() => { currentPriceRef.current = currentPrice; }, [currentPrice]);
  useEffect(() => { barsRef.current = bars; }, [bars]);
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
  useEffect(() => { displayIntervalSecondsRef.current = displayIntervalSeconds; }, [displayIntervalSeconds]);
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
    trendLinePrimitiveRef.current?.setDrawings({
      drawings: drawingsRef.current.filter((drawing): drawing is TrendLineDrawing => drawing.type === DRAWING_TYPE_TREND_LINE),
      selectedDrawingId: selectedDrawingIdRef.current,
      preview: drawingPreviewRef.current,
      draft: drawingToolRef.current === DRAWING_TYPE_TREND_LINE ? drawingDraftRef.current : null,
      draftStyle: trendLineDraftStyleRef.current,
      bars: barsRef.current,
      displayIntervalSeconds: displayIntervalSecondsRef.current,
      priceTickSize: priceTickSizeRef.current,
    });
    fibonacciPrimitiveRef.current?.setDrawings({
      drawings: drawingsRef.current.filter((drawing): drawing is FibonacciRetracementDrawing => drawing.type === DRAWING_TYPE_FIB_RETRACEMENT),
      selectedDrawingId: selectedDrawingIdRef.current,
      preview: drawingPreviewRef.current,
      draft: drawingToolRef.current === DRAWING_TYPE_FIB_RETRACEMENT ? drawingDraftRef.current : null,
      draftStyle: fibonacciDraftStyleRef.current,
      bars: barsRef.current,
      displayIntervalSeconds: displayIntervalSecondsRef.current,
      priceTickSize: priceTickSizeRef.current,
    });
  }, []);

  const setChartCursor = useCallback((cursor: "" | "crosshair" | "ns-resize" | "move" | "pointer") => {
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = cursor;
    container.querySelectorAll("canvas").forEach((canvas) => { canvas.style.cursor = cursor; });
  }, []);

  useEffect(() => {
    requestAnimationFrame(syncDrawingPrimitive);
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

  useEffect(() => {
    if (!paperSessionId || paperInitialCapital === null) {
      setDefaultRiskAmount(null);
      return;
    }
    const fallback = paperInitialCapital * 0.01;
    try {
      const stored = JSON.parse(window.localStorage.getItem(`market-replay-risk-settings-v1:${datasetId}`) ?? "null") as { riskAmount?: unknown; targetR?: unknown } | null;
      setDefaultRiskAmount(typeof stored?.riskAmount === "number" && stored.riskAmount > 0 ? stored.riskAmount : fallback);
      setDefaultTargetR(typeof stored?.targetR === "number" && stored.targetR > 0 ? stored.targetR : 2);
    } catch {
      setDefaultRiskAmount(fallback);
      setDefaultTargetR(2);
    }
  }, [datasetId, paperInitialCapital, paperSessionId]);

  useEffect(() => {
    onDraftActiveChange(Boolean(draft));
  }, [draft, onDraftActiveChange]);

  useEffect(() => {
    if (paperSessionId === null && draft !== null) {
      setDraft(null);
      setDraftError(null);
    }
  }, [draft, paperSessionId]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

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
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "zh-CN", timeFormatter: (time: Time) => typeof time === "number" ? formatUtcDateTime(time * 1_000, displayUtcOffsetRef.current) : String(time) },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        shiftVisibleRangeOnNewBar: false,
        lockVisibleTimeRangeOnResize: true,
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
    candles.attachPrimitive(trendLinePrimitive);
    candles.attachPrimitive(fibonacciPrimitive);
    candles.attachPrimitive(tradeAnnotationPrimitive);
    candles.attachPrimitive(barCountPrimitive);
    tradeAnnotationPrimitive.setData({ entries: tradeAnnotationsRef.current, bars: barsRef.current });
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
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = null;
    trendLinePrimitiveRef.current = trendLinePrimitive;
    fibonacciPrimitiveRef.current = fibonacciPrimitive;
    tradeAnnotationPrimitiveRef.current = tradeAnnotationPrimitive;
    barCountPrimitiveRef.current = barCountPrimitive;
    syncDrawingPrimitive();
    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMeasurementCoordinates);
      candles.detachPrimitive(trendLinePrimitive);
      candles.detachPrimitive(fibonacciPrimitive);
      candles.detachPrimitive(tradeAnnotationPrimitive);
      candles.detachPrimitive(barCountPrimitive);
      trendLinePrimitiveRef.current = null;
      fibonacciPrimitiveRef.current = null;
      tradeAnnotationPrimitiveRef.current = null;
      barCountPrimitiveRef.current = null;
      chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      priceLines.clear(); lineTargets.clear(); lastDataRef.current = [];
    };
  }, [priceTickSize, syncDrawingPrimitive, syncLineActionCoordinates, syncMeasurementCoordinates]);

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
    volumes.setData(barsRef.current.filter((bar) => bar.volume !== null).map(volume));
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
    displayIntervalSecondsRef.current = displayIntervalSeconds;
    requestAnimationFrame(syncDrawingPrimitive);
    requestAnimationFrame(syncMeasurementCoordinates);
  }, [displayIntervalSeconds, syncDrawingPrimitive, syncMeasurementCoordinates]);

  useEffect(() => {
    requestAnimationFrame(syncDrawingPrimitive);
  }, [fibonacciDraftStyle, syncDrawingPrimitive, trendLineDraftStyle]);

  useEffect(() => {
    const chart = chartRef.current; const series = candleRef.current;
    if (!chart || !series) return;
    const previous = lastDataRef.current;
    const next = bars;
    const volumeSeries = volumeRef.current;
    const candleWasAutoScaled = series.priceScale().options().autoScale;
    const volumeWasAutoScaled = volumeSeries?.priceScale().options().autoScale ?? true;
    const samePrefix = previous.length > 0 && next.length >= previous.length
      && previous.slice(0, -1).every((bar, index) => bar.timestamp === next[index]?.timestamp);
    if (samePrefix) {
      const range = chart.timeScale().getVisibleLogicalRange();
      const previousLastIndex = previous.length - 1;
      for (const bar of next.slice(Math.max(0, previous.length - 1))) {
        series.update(candle(bar)); if (bar.volume !== null) volumeSeries?.update(volume(bar));
      }
      if (range && next.length > previous.length) {
        chart.timeScale().setVisibleLogicalRange(rangeAfterNewReplayBar(range, previousLastIndex, next.length - previous.length));
      }
    } else {
      const range = chart.timeScale().getVisibleLogicalRange();
      const previousLastIndex = previous.length - 1;
      const previousLastInNext = next.findIndex((bar) => bar.timestamp === previous.at(-1)?.timestamp);
      series.setData(next.map(candle));
      volumeSeries?.setData(next.filter((bar) => bar.volume !== null).map(volume));
      if (range && previousLastInNext >= 0) {
        // A rolling server window renumbers logical indices. Preserve zoom and historical panning.
        const advanced = rangeAfterNewReplayBar(range, previousLastIndex, next.length - 1 - previousLastInNext);
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
    lastDataRef.current = next.map((bar) => ({ ...bar }));
    requestAnimationFrame(syncMeasurementCoordinates);
    requestAnimationFrame(syncDrawingPrimitive);
  }, [bars, syncDrawingPrimitive, syncMeasurementCoordinates]);

  useEffect(() => {
    if (focusSequence === null) return;
    const index = bars.findIndex((bar) => focusSequence >= bar.firstSequence && focusSequence <= bar.lastSequence);
    const chart = chartRef.current;
    if (index < 0 || !chart) return;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, index - 30), to: index + 30 });
  }, [bars, focusSequence]);

  useEffect(() => {
    tradeAnnotationPrimitiveRef.current?.setData({ entries: tradeAnnotations, bars });
  }, [bars, tradeAnnotations]);

  useEffect(() => {
    barCountPrimitiveRef.current?.setData({
      bars,
      displaySession,
      displayIntervalSeconds,
      session: barCountSession,
      config: barCountConfig,
    });
  }, [barCountConfig, barCountSession, bars, displayIntervalSeconds, displaySession]);

  useReplayChartEma({
    chartRef,
    bars,
    warmupBars,
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
    for (const line of priceLinesRef.current.values()) series.removePriceLine(line);
    priceLinesRef.current.clear();
    lineTargetsRef.current.clear();
    const nextLineActions: LineAction[] = [];
    const addLine = (target: LineTarget | null, price: number, color: string, title: string, solid = false) => {
      const key = target?.key ?? `static:${title}`;
      priceLinesRef.current.set(key, series.createPriceLine({ price, color, lineWidth: 1, lineStyle: solid ? 0 : 2, axisLabelVisible: true, title }));
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
          ? formatRMultiple(rMultipleAtPrice(rReference, order.price))
          : copy.paperTrading.orderLine(order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell, order.type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop);
        addLine({ key: order.id, price: order.price, kind: "order", field: "price", orderId: order.id, rReference: rReference ?? undefined }, order.price, color, title, order.isProtective);
        addAction({ key: order.id, price: order.price, color, label: order.isProtective ? title : `${title} · ${number(order.quantity)}`, kind: "cancel", orderId: order.id });
      }
      if (!order.isProtective && order.stopLoss !== null) {
        const reference = order.price === null ? null : createBracketRReference(order.side, order.price, order.stopLoss);
        const title = formatRMultiple(rMultipleAtPrice(reference, order.stopLoss));
        addLine({ key: `${order.id}:sl`, price: order.stopLoss, kind: "order", field: "stopLoss", orderId: order.id }, order.stopLoss, "#dc2626", title, true);
      }
      if (!order.isProtective && order.takeProfit !== null) {
        const reference = order.price === null || order.stopLoss === null ? null : createBracketRReference(order.side, order.price, order.stopLoss);
        const title = formatRMultiple(rMultipleAtPrice(reference, order.takeProfit));
        addLine({ key: `${order.id}:tp`, price: order.takeProfit, kind: "order", field: "takeProfit", orderId: order.id, rReference: reference ?? undefined }, order.takeProfit, "#16a34a", title, true);
      }
    }
    if (draft && paperSnapshot) {
      const side = draft.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell;
      const reference = createBracketRReference(draft.side, draft.entryPrice, draft.stopLoss);
      addLine({ key: "draft:entry", price: draft.entryPrice, kind: "draft", field: "entryPrice" }, draft.entryPrice, "#2563eb", copy.paperTrading.orderLine(side, orderTypeLabel(draft.type)), true);
      addLine({ key: "draft:sl", price: draft.stopLoss, kind: "draft", field: "stopLoss" }, draft.stopLoss, "#dc2626", formatRMultiple(rMultipleAtPrice(reference, draft.stopLoss)), true);
      addLine({ key: "draft:tp", price: draft.takeProfit, kind: "draft", field: "takeProfit" }, draft.takeProfit, "#16a34a", formatRMultiple(rMultipleAtPrice(reference, draft.takeProfit)), true);
    }
    setLineActions((current) => sameLineActions(current, nextLineActions) ? current : nextLineActions);
  }, [draft, draftSizing, paperSnapshot]);

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
      kind: "start" | "end" | "line";
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
      if (snappedX === null || snappedY === null) return null;
      return {
        anchor: anchorForLogicalIndex({
          logicalIndex: index,
          price,
          bars: currentBars,
          displayIntervalSeconds: displayIntervalSecondsRef.current,
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
      if (!trend) return fibonacci;
      if (!fibonacci) return trend;
      if (trend.priority !== fibonacci.priority) return trend.priority > fibonacci.priority ? trend : fibonacci;
      return trend.distance <= fibonacci.distance ? trend : fibonacci;
    };
    const drawingCoordinates = (drawing: MarketDrawing) => (
      drawing.type === DRAWING_TYPE_TREND_LINE
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
        onCreateDrawingRef.current(activeTool, { start: current.start, end: end.anchor });
        commitDraft(null, null);
        drawingToolRef.current = null;
        onDrawingToolChangeRef.current(null);
        setChartCursor("");
        return;
      }

      const rect = container.getBoundingClientRect();
      const hit = hitDrawingAt({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      if (!hit) {
        if (!event.shiftKey) onSelectedDrawingIdChangeRef.current(null);
        return;
      }
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

    const move = (event: PointerEvent) => {
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
        if (start && end) geometry = { start: start.anchor, end: end.anchor };
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
      if (geometry) commitPreview({ id: dragging.id, geometry });
    };

    const finish = (event: PointerEvent) => {
      if (!dragging) return;
      stopEvent(event);
      const preview = drawingPreviewRef.current;
      if (preview?.id === dragging.id) onUpdateDrawingRef.current(preview.id, preview.geometry);
      dragging = null;
      requestAnimationFrame(() => commitPreview(null));
      if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
      chart.applyOptions({ handleScroll: true });
      setChartCursor("");
    };
    const cancelDrag = () => {
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
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable='true'],[role='dialog']")) return;
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
      if (event.key === "Delete" && selectedDrawingIdRef.current) {
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
      const tooltipHeight = abrEnabled ? 138 : 112;
      const preferredLeft = x + 14;
      const left = preferredLeft + tooltipWidth <= paneWidth - 8
        ? preferredLeft
        : Math.max(8, x - tooltipWidth - 14);
      const top = Math.max(8, Math.min(y + 12, Math.max(8, paneHeight - tooltipHeight - 8)));
      return { left, top, bar, value: abrValuesRef.current[index] ?? null };
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
      .map((target) => ({ target, coordinate: series.priceToCoordinate(target.price) }))
      .filter((item) => item.coordinate !== null)
      .sort((a, b) => Math.abs(Number(a.coordinate) - y) - Math.abs(Number(b.coordinate) - y))[0];
    const down = (event: PointerEvent) => {
      if (event.shiftKey || measurementArmedRef.current || drawingToolRef.current || drawingDraftRef.current || drawingPreviewRef.current) return;
      if ((event.target as HTMLElement | null)?.closest("button,input,[data-context-menu]")) return;
      const y = event.clientY - container.getBoundingClientRect().top;
      const dragKey = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-line-drag-key]")?.dataset.lineDragKey;
      const directTarget = dragKey ? lineTargetsRef.current.get(dragKey) : undefined;
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
        const rLabel = target.rReference ? formatRMultiple(rMultipleAtPrice(target.rReference, price)) : null;
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
  }, [moveDraftLine, priceTickSize, setChartCursor, syncLineActionCoordinates]);

  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (drawingToolRef.current || drawingDraftRef.current || drawingPreviewRef.current) return;
    if ((event.target as HTMLElement).closest("[data-order-ticket],[data-context-menu],[data-line-action]")) return;
    const series = candleRef.current;
    const root = event.currentTarget.getBoundingClientRect();
    const rawPrice = series?.coordinateToPrice((event.clientY - root.top) as never);
    const price = snapPriceToTick(Number(rawPrice), priceTickSize);
    const fallback = currentPrice ?? 0;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX - root.left, root.width - 228)),
      y: Math.max(8, Math.min(event.clientY - root.top, root.height - 220)),
      price: Number.isFinite(price) && price > 0 ? price : fallback,
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
    requestAnimationFrame(() => {
      trendLinePrimitiveRef.current?.requestRedraw();
      fibonacciPrimitiveRef.current?.requestRedraw();
    });
  }

  function createDraft(side: PaperSide, type: "LIMIT" | "STOP") {
    if (!paperSnapshot || !latest || !contextMenu || contextMenu.price <= 0) return;
    const rawDistance = latest.high > latest.low && Number.isFinite(latest.high - latest.low)
      ? latest.high - latest.low
      : contextMenu.price * 0.01;
    const distance = Math.max(priceTickSize, Math.round(Math.min(rawDistance, contextMenu.price * 0.99) / priceTickSize) * priceTickSize);
    const riskAmount = defaultRiskAmount ?? paperSnapshot.session.initialCapital * 0.01;
    const stopLoss = snapPriceToTick(side === "BUY" ? contextMenu.price - distance : contextMenu.price + distance, priceTickSize);
    const targetR = defaultTargetR > 0 ? defaultTargetR : 2;
    setDraft({
      side, type, entryPrice: contextMenu.price, stopLoss,
      takeProfit: snapPriceToTick(targetPriceForR(side, contextMenu.price, stopLoss, targetR), priceTickSize),
      riskAmount, targetR, tpMode: "LINKED",
    });
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

  function saveDefaults() {
    if (!draft || draft.riskAmount <= 0 || draft.targetR <= 0) return;
    setDefaultRiskAmount(draft.riskAmount); setDefaultTargetR(draft.targetR);
    try {
      window.localStorage.setItem(`market-replay-risk-settings-v1:${datasetId}`, JSON.stringify({ riskAmount: draft.riskAmount, targetR: draft.targetR }));
    } catch {
      // Local storage is optional; the current draft remains usable.
    }
    setDefaultSaved(true);
  }

  async function submitDraft() {
    if (!draft || !draftSizing?.ok) return;
    const success = await onSubmitOrder({
      side: draft.side, type: draft.type, quantity: draftSizing.value.quantity,
      riskAmount: draft.riskAmount, price: draft.entryPrice,
      stopLoss: draft.stopLoss, takeProfit: draft.takeProfit,
    });
    if (success) {
      setDraft(null); setDraftError(null);
    } else setDraftError(copy.paperTrading.draftSubmitFailed);
  }

  const menuBelowCurrent = currentPrice !== null && contextMenu !== null && contextMenu.price < currentPrice;
  const measurementColor = measurement
    ? measurement.stats.priceChange > 0 ? "#2962ff" : measurement.stats.priceChange < 0 ? "#f23645" : "#64748b"
    : "#64748b";
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
      <div ref={containerRef} className="h-full min-h-[240px] w-full overflow-hidden bg-white" aria-label={copy.marketReplay.chartAriaLabel} />

      {tradeAnnotationsTruncated ? (
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
          </div>
        </div>
      ) : null}

      {measurement ? (
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
            <line x1={measurement.end.x} y1={0} x2={measurement.end.x} y2={measurement.paneHeight} stroke={measurementColor} strokeWidth="1" strokeDasharray="5 5" opacity="0.72" />
            <line x1={0} y1={measurement.end.y} x2={measurement.paneWidth} y2={measurement.end.y} stroke={measurementColor} strokeWidth="1" strokeDasharray="5 5" opacity="0.72" />
            <rect
              x={Math.min(measurement.start.x, measurement.end.x)}
              y={Math.min(measurement.start.y, measurement.end.y)}
              width={Math.abs(measurement.end.x - measurement.start.x)}
              height={Math.abs(measurement.end.y - measurement.start.y)}
              fill={measurementColor}
              fillOpacity="0.16"
              stroke={measurementColor}
              strokeWidth="1"
              strokeOpacity="0.72"
            />
            <line x1={measurement.start.x} y1={measurement.end.y} x2={measurement.end.x} y2={measurement.end.y} stroke={measurementColor} strokeWidth="1.5" />
            <line x1={measurement.end.x} y1={measurement.start.y} x2={measurement.end.x} y2={measurement.end.y} stroke={measurementColor} strokeWidth="1.5" />
            <circle cx={measurement.start.x} cy={measurement.start.y} r="2.5" fill="#fff" stroke={measurementColor} strokeWidth="1.5" />
            <circle cx={measurement.end.x} cy={measurement.end.y} r="2.5" fill="#fff" stroke={measurementColor} strokeWidth="1.5" />
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

      {latest?.status !== "COMPLETE" ? (
        <div className={`pointer-events-none absolute left-3 top-3 rounded-md px-2 py-1 text-xs shadow-sm ${latest?.status === "INCOMPLETE" ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-800"}`}>
          {latest?.status === "INCOMPLETE" ? copy.marketReplay.incompleteBar(latest.sourceCount, latest.expectedCount) : latest ? copy.marketReplay.formingBar(latest.sourceCount, latest.expectedCount) : null}
        </div>
      ) : null}

      {!draft && paperSnapshot && latest ? <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm backdrop-blur">{copy.paperTrading.rightClickHint}</div> : null}

      {contextMenu ? (
        <div data-context-menu role="menu" className="absolute z-40 w-[220px] overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="mb-1 border-b pb-1">
            <button type="button" role="menuitem" data-testid="context-reset-chart-view" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={resetChartView}>
              <RotateCcw className="h-4 w-4" />
              {copy.marketReplay.resetChartView}
            </button>
          </div>
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
          ) : menuBelowCurrent ? (
            <div className="space-y-0.5 pt-1">
              <button type="button" role="menuitem" data-testid="context-buy-limit" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => createDraft("BUY", "LIMIT")}>{copy.paperTrading.buyLimit}</button>
              <button type="button" role="menuitem" data-testid="context-sell-stop" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50" onClick={() => createDraft("SELL", "STOP")}>{copy.paperTrading.sellStop}</button>
            </div>
          ) : (
            <div className="space-y-0.5 pt-1">
              <button type="button" role="menuitem" data-testid="context-sell-limit" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-orange-700 hover:bg-orange-50" onClick={() => createDraft("SELL", "LIMIT")}>{copy.paperTrading.sellLimit}</button>
              <button type="button" role="menuitem" data-testid="context-buy-stop" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => createDraft("BUY", "STOP")}>{copy.paperTrading.buyStop}</button>
            </div>
          )}
        </div>
      ) : null}

      {draft && paperSnapshot ? (
        <div data-order-ticket data-testid="risk-order-ticket" className="absolute right-16 top-3 z-30 w-[292px] rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
          <div className="flex items-start justify-between border-b px-3 py-2.5">
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${draft.side === "BUY" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{draft.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell}</span>
                <span className="text-sm font-semibold text-slate-950">{copy.paperTrading.draftTitle}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{copy.paperTrading.draftDescription}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 h-7 w-7" aria-label={copy.paperTrading.cancelDraft} onClick={() => { setDraft(null); setDraftError(null); }}><X className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-3 p-3">
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
              <Button type="button" variant="outline" size="sm" disabled={paperBusy} onClick={() => { setDraft(null); setDraftError(null); }}>{copy.paperTrading.cancelDraft}</Button>
              <Button type="button" size="sm" data-testid="confirm-risk-order" disabled={paperBusy || !draftSizing?.ok} onClick={() => void submitDraft()}>{paperBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{paperBusy ? copy.paperTrading.submitting : copy.paperTrading.confirmDraft}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
