"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link2, Loader2, LogOut, RotateCcw, ShieldAlert, X } from "lucide-react";
import {
  CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode,
  HistogramSeries, LineSeries, type IChartApi, type IPriceLine, type ISeriesApi,
  type ISeriesMarkersPluginApi, type Time, TickMarkType, type UTCTimestamp,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateEmaSeries, nextEma } from "@/lib/market-replay/ema";
import type { AggregatedMarketBarData, EmaIndicatorConfig } from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
import { defaultReplayLogicalRange, rangeAfterNewReplayBar } from "@/lib/market-replay/chart-range";
import {
  calculateChartMeasurement,
  measurementDurationParts,
  type ChartMeasurementStats,
} from "@/lib/market-replay/chart-measurement";
import {
  anchorForLogicalIndex,
  logicalIndexForAnchor,
  snapScreenPointTo45,
  trendLineDashArray,
  type DrawingAnchor,
  type TrendLineDrawing,
  type TrendLineGeometry,
} from "@/lib/market-replay/chart-drawings";
import { formatUtcDateTime, utcDateParts } from "@/lib/market-replay/display-timezone";
import { formatPriceForTick, priceDecimalsForTick, snapPriceToTick } from "@/lib/market-replay/price-ticks";
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
import type { PaperSessionSnapshot, PaperSide } from "@/lib/paper-trading/types";

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
type DrawingCoordinate = {
  drawing: TrendLineDrawing;
  start: { x: number; y: number };
  end: { x: number; y: number };
};
type DrawingDraft = {
  start: DrawingAnchor;
  end: DrawingAnchor;
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
  onMeasurementArmedChange, drawingTool, onDrawingToolChange, drawings, selectedDrawingId,
  onSelectedDrawingIdChange, onCreateTrendLine, onUpdateTrendLine, onDeleteTrendLine,
  onOpenTrendLineStyle, emaEnabled, emaIndicators, paperSnapshot,
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
  onMeasurementArmedChange: (armed: boolean) => void;
  drawingTool: "TREND_LINE" | null;
  onDrawingToolChange: (tool: "TREND_LINE" | null) => void;
  drawings: TrendLineDrawing[];
  selectedDrawingId: string | null;
  onSelectedDrawingIdChange: (id: string | null) => void;
  onCreateTrendLine: (geometry: TrendLineGeometry) => void;
  onUpdateTrendLine: (id: string, geometry: TrendLineGeometry) => void;
  onDeleteTrendLine: (id: string) => void;
  onOpenTrendLineStyle: (id: string) => void;
  emaEnabled: boolean;
  emaIndicators: EmaIndicatorConfig[];
  paperSnapshot: PaperSessionSnapshot | null;
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
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const emaSeriesRef = useRef(new Map<string, ISeriesApi<"Line">>());
  const emaStateRef = useRef(new Map<string, {
    length: number;
    bars: Array<{ timestamp: string; close: number }>;
    values: Array<number | null>;
  }>());
  const lastDataRef = useRef<AggregatedMarketBarData[]>([]);
  const barsRef = useRef(bars);
  const measurementArmedRef = useRef(measurementArmed);
  const onMeasurementArmedChangeRef = useRef(onMeasurementArmedChange);
  const drawingToolRef = useRef(drawingTool);
  const drawingsRef = useRef(drawings);
  const selectedDrawingIdRef = useRef(selectedDrawingId);
  const onDrawingToolChangeRef = useRef(onDrawingToolChange);
  const onSelectedDrawingIdChangeRef = useRef(onSelectedDrawingIdChange);
  const onCreateTrendLineRef = useRef(onCreateTrendLine);
  const onUpdateTrendLineRef = useRef(onUpdateTrendLine);
  const onDeleteTrendLineRef = useRef(onDeleteTrendLine);
  const onOpenTrendLineStyleRef = useRef(onOpenTrendLineStyle);
  const displayIntervalSecondsRef = useRef(displayIntervalSeconds);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [measurement, setMeasurement] = useState<MeasurementState | null>(null);
  const measurementRef = useRef<MeasurementState | null>(null);
  const [drawingDraft, setDrawingDraft] = useState<DrawingDraft | null>(null);
  const drawingDraftRef = useRef<DrawingDraft | null>(null);
  const [drawingDraftCoordinate, setDrawingDraftCoordinate] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const drawingDraftCoordinateRef = useRef<typeof drawingDraftCoordinate>(null);
  const [drawingPreview, setDrawingPreview] = useState<{ id: string; geometry: TrendLineGeometry } | null>(null);
  const drawingPreviewRef = useRef<{ id: string; geometry: TrendLineGeometry } | null>(null);
  const [drawingCoordinates, setDrawingCoordinates] = useState<DrawingCoordinate[]>([]);
  const drawingCoordinatesRef = useRef<DrawingCoordinate[]>([]);
  const [draft, setDraft] = useState<DraftOrder | null>(null);
  const [defaultRiskAmount, setDefaultRiskAmount] = useState<number | null>(null);
  const [defaultTargetR, setDefaultTargetR] = useState(2);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [lineActions, setLineActions] = useState<LineAction[]>([]);
  const hasVolume = useMemo(() => [...warmupBars, ...bars].some((bar) => bar.volume !== null), [bars, warmupBars]);
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
  useEffect(() => { onCreateTrendLineRef.current = onCreateTrendLine; }, [onCreateTrendLine]);
  useEffect(() => { onUpdateTrendLineRef.current = onUpdateTrendLine; }, [onUpdateTrendLine]);
  useEffect(() => { onDeleteTrendLineRef.current = onDeleteTrendLine; }, [onDeleteTrendLine]);
  useEffect(() => { onOpenTrendLineStyleRef.current = onOpenTrendLineStyle; }, [onOpenTrendLineStyle]);
  useEffect(() => { displayIntervalSecondsRef.current = displayIntervalSeconds; }, [displayIntervalSeconds]);
  useEffect(() => { drawingDraftRef.current = drawingDraft; }, [drawingDraft]);
  useEffect(() => { drawingPreviewRef.current = drawingPreview; }, [drawingPreview]);
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

  const syncDrawingCoordinates = useCallback(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series) return;
    const currentBars = barsRef.current;
    const interval = displayIntervalSecondsRef.current;
    const preview = drawingPreviewRef.current;
    const next = drawingsRef.current.flatMap((drawing) => {
      const geometry = preview?.id === drawing.id ? preview.geometry : drawing.geometry;
      const startIndex = logicalIndexForAnchor(geometry.start, currentBars, interval);
      const endIndex = logicalIndexForAnchor(geometry.end, currentBars, interval);
      if (startIndex === null || endIndex === null) return [];
      const startX = chart.timeScale().logicalToCoordinate(startIndex as never);
      const endX = chart.timeScale().logicalToCoordinate(endIndex as never);
      const startY = series.priceToCoordinate(geometry.start.price);
      const endY = series.priceToCoordinate(geometry.end.price);
      if (startX === null || endX === null || startY === null || endY === null) return [];
      return [{
        drawing: preview?.id === drawing.id ? { ...drawing, geometry } : drawing,
        start: { x: Number(startX), y: Number(startY) },
        end: { x: Number(endX), y: Number(endY) },
      }];
    });
    drawingCoordinatesRef.current = next;
    setDrawingCoordinates(next);
    const draft = drawingDraftRef.current;
    if (draft) {
      const startIndex = logicalIndexForAnchor(draft.start, currentBars, interval);
      const endIndex = logicalIndexForAnchor(draft.end, currentBars, interval);
      if (startIndex !== null && endIndex !== null) {
        const startX = chart.timeScale().logicalToCoordinate(startIndex as never);
        const endX = chart.timeScale().logicalToCoordinate(endIndex as never);
        const startY = series.priceToCoordinate(draft.start.price);
        const endY = series.priceToCoordinate(draft.end.price);
        if (startX !== null && endX !== null && startY !== null && endY !== null) {
          const coordinate = {
            start: { x: Number(startX), y: Number(startY) },
            end: { x: Number(endX), y: Number(endY) },
          };
          drawingDraftCoordinateRef.current = coordinate;
          setDrawingDraftCoordinate(coordinate);
        }
      }
    }
  }, []);

  const setChartCursor = useCallback((cursor: "" | "crosshair" | "ns-resize" | "move" | "pointer") => {
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = cursor;
    container.querySelectorAll("canvas").forEach((canvas) => { canvas.style.cursor = cursor; });
  }, []);

  useEffect(() => {
    requestAnimationFrame(syncDrawingCoordinates);
  }, [drawings, syncDrawingCoordinates]);

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
        priceTickSize,
        displayIntervalSeconds,
      }),
    };
    measurementRef.current = next;
    setMeasurement(next);
  }, [displayIntervalSeconds, priceTickSize, setChartCursor]);

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const priceLines = priceLinesRef.current;
    const lineTargets = lineTargetsRef.current;
    const emaSeries = emaSeriesRef.current;
    const emaStates = emaStateRef.current;
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
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatChartTick(time, tickMarkType, displayUtcOffsetRef.current),
      },
      rightPriceScale: { borderColor: "#e2e8f0" },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626", wickUpColor: "#16a34a", wickDownColor: "#dc2626", borderVisible: true,
      priceFormat: { type: "price", minMove: priceTickSize, precision: priceDecimalsForTick(priceTickSize) },
    });
    let volumes: ISeriesApi<"Histogram"> | null = null;
    if (hasVolume) {
      const pane = chart.addPane();
      chart.panes()[0]?.setStretchFactor(4); pane.setStretchFactor(1);
      volumes = pane.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width && entry.contentRect.height) {
        chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
        syncLineActionCoordinates();
        syncMeasurementCoordinates();
        syncDrawingCoordinates();
      }
    });
    observer.observe(container);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncMeasurementCoordinates);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncDrawingCoordinates);
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = volumes;
    markersRef.current = createSeriesMarkers(candles, []);
    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMeasurementCoordinates);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncDrawingCoordinates);
      chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      markersRef.current = null; priceLines.clear(); lineTargets.clear(); emaSeries.clear(); emaStates.clear(); lastDataRef.current = [];
    };
  }, [hasVolume, priceTickSize, syncDrawingCoordinates, syncLineActionCoordinates, syncMeasurementCoordinates]);

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
    requestAnimationFrame(syncDrawingCoordinates);
  }, [displayIntervalSeconds, syncDrawingCoordinates]);

  useEffect(() => {
    const chart = chartRef.current; const series = candleRef.current;
    if (!chart || !series) return;
    const previous = lastDataRef.current;
    const next = bars;
    const samePrefix = previous.length > 0 && next.length >= previous.length
      && previous.slice(0, -1).every((bar, index) => bar.timestamp === next[index]?.timestamp);
    if (samePrefix) {
      const range = chart.timeScale().getVisibleLogicalRange();
      const previousLastIndex = previous.length - 1;
      for (const bar of next.slice(Math.max(0, previous.length - 1))) {
        series.update(candle(bar)); if (bar.volume !== null) volumeRef.current?.update(volume(bar));
      }
      if (range && next.length > previous.length) {
        chart.timeScale().setVisibleLogicalRange(rangeAfterNewReplayBar(range, previousLastIndex, next.length - previous.length));
      }
    } else {
      const range = chart.timeScale().getVisibleLogicalRange();
      const previousLastIndex = previous.length - 1;
      const previousLastInNext = next.findIndex((bar) => bar.timestamp === previous.at(-1)?.timestamp);
      series.setData(next.map(candle));
      volumeRef.current?.setData(next.filter((bar) => bar.volume !== null).map(volume));
      if (range && previousLastInNext >= 0) {
        // A rolling server window renumbers logical indices. Preserve zoom and historical panning.
        const advanced = rangeAfterNewReplayBar(range, previousLastIndex, next.length - 1 - previousLastInNext);
        const removed = previousLastIndex - previousLastInNext;
        chart.timeScale().setVisibleLogicalRange({ from: advanced.from - removed, to: advanced.to - removed });
      } else if (next.length > 0) {
        chart.timeScale().setVisibleLogicalRange(defaultReplayLogicalRange(chart.timeScale().width(), next.length));
      }
    }
    lastDataRef.current = next.map((bar) => ({ ...bar }));
    requestAnimationFrame(syncMeasurementCoordinates);
    requestAnimationFrame(syncDrawingCoordinates);
  }, [bars, syncDrawingCoordinates, syncMeasurementCoordinates]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const active = emaEnabled ? emaIndicators.filter((item) => item.visible) : [];
    const activeIds = new Set(active.map((item) => item.id));
    for (const [id, series] of emaSeriesRef.current) {
      if (!activeIds.has(id)) {
        chart.removeSeries(series);
        emaSeriesRef.current.delete(id);
        emaStateRef.current.delete(id);
      }
    }
    const all = [...warmupBars, ...bars];
    for (const indicator of active) {
      let series = emaSeriesRef.current.get(indicator.id);
      if (!series) {
        series = chart.addSeries(LineSeries, { color: indicator.color, title: copy.marketReplay.emaLine(indicator.length), lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false });
        emaSeriesRef.current.set(indicator.id, series);
      }
      series.applyOptions({ color: indicator.color, title: copy.marketReplay.emaLine(indicator.length) });
      const previous = emaStateRef.current.get(indicator.id);
      const samePrefix = previous?.length === indicator.length
        && all.length >= previous.bars.length
        && previous.bars.slice(0, -1).every((bar, index) => bar.timestamp === all[index]?.timestamp);
      if (!previous || !samePrefix) {
        const result = calculateEmaSeries(all, indicator.length, all.length - 1, 0);
        const values: Array<number | null> = Array(all.length).fill(null);
        for (const point of result.points) values[point.sequence] = point.value;
        series.setData(result.points.filter((point) => point.sequence >= warmupBars.length)
          .map((point) => ({ time: chartTime(all[point.sequence].timestamp), value: point.value })));
        emaStateRef.current.set(indicator.id, {
          length: indicator.length,
          bars: all.map((bar) => ({ timestamp: bar.timestamp, close: bar.close })),
          values,
        });
        continue;
      }
      const values = previous.values.slice(0, all.length);
      while (values.length < all.length) values.push(null);
      const start = Math.max(indicator.length - 1, previous.bars.length - 1);
      for (let index = start; index < all.length; index += 1) {
        if (index === indicator.length - 1) {
          values[index] = all.slice(0, indicator.length).reduce((sum, bar) => sum + bar.close, 0) / indicator.length;
        } else {
          const prior = values[index - 1];
          values[index] = prior === null ? null : nextEma(prior, all[index].close, indicator.length);
        }
        if (values[index] !== null && index >= warmupBars.length) {
          series.update({ time: chartTime(all[index].timestamp), value: values[index]! });
        }
      }
      emaStateRef.current.set(indicator.id, {
        length: indicator.length,
        bars: all.map((bar) => ({ timestamp: bar.timestamp, close: bar.close })),
        values,
      });
    }
  }, [bars, emaEnabled, emaIndicators, warmupBars]);

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
    markersRef.current?.setMarkers((paperSnapshot?.recentFills ?? []).flatMap((fill) => {
      const aggregate = bars.find((bar) => fill.sequence >= bar.firstSequence && fill.sequence <= bar.lastSequence);
      if (!aggregate) return [];
      return [{ time: chartTime(aggregate.timestamp), position: fill.side === "BUY" ? "belowBar" as const : "aboveBar" as const, shape: fill.side === "BUY" ? "arrowUp" as const : "arrowDown" as const, color: fill.side === "BUY" ? "#16a34a" : "#dc2626", text: fill.reason }];
    }));
    setLineActions((current) => sameLineActions(current, nextLineActions) ? current : nextLineActions);
  }, [bars, draft, draftSizing, paperSnapshot]);

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
    const commitDraft = (next: DrawingDraft | null, coordinate: typeof drawingDraftCoordinate) => {
      drawingDraftRef.current = next;
      drawingDraftCoordinateRef.current = coordinate;
      setDrawingDraft(next);
      setDrawingDraftCoordinate(coordinate);
    };
    const commitPreview = (next: typeof drawingPreview) => {
      drawingPreviewRef.current = next;
      setDrawingPreview(next);
      requestAnimationFrame(syncDrawingCoordinates);
    };
    const stopEvent = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setContextMenu(null);
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !container.contains(event.target as Node)) return;
      const target = event.target as HTMLElement;
      if (target.closest("button,input,[data-context-menu],[data-order-ticket],[data-line-action]")) return;

      if (drawingToolRef.current === "TREND_LINE") {
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
        if (event.shiftKey && draftCoordinate) {
          const rect = container.getBoundingClientRect();
          const snapped = snapScreenPointTo45(draftCoordinate.start, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
          end = pointAtCoordinate(snapped.x, snapped.y, false) ?? initial;
        }
        onCreateTrendLineRef.current({ start: current.start, end: end.anchor });
        commitDraft(null, null);
        drawingToolRef.current = null;
        onDrawingToolChangeRef.current(null);
        setChartCursor("");
        return;
      }

      const hit = target.closest<SVGElement>("[data-drawing-id]");
      const id = hit?.dataset.drawingId;
      if (!id) {
        if (!event.shiftKey) onSelectedDrawingIdChangeRef.current(null);
        return;
      }
      const drawing = drawingsRef.current.find((item) => item.id === id);
      const coordinate = drawingCoordinatesRef.current.find((item) => item.drawing.id === id);
      if (!drawing || !coordinate || id.startsWith("temporary-")) return;
      stopEvent(event);
      onSelectedDrawingIdChangeRef.current(id);
      selectedDrawingIdRef.current = id;
      dragging = {
        id,
        kind: hit.dataset.drawingHandle === "start" ? "start" : hit.dataset.drawingHandle === "end" ? "end" : "line",
        clientX: event.clientX,
        clientY: event.clientY,
        geometry: drawing.geometry,
        start: coordinate.start,
        end: coordinate.end,
      };
      interaction.setPointerCapture(event.pointerId);
      setChartCursor(dragging.kind === "line" ? "move" : "crosshair");
    };

    const move = (event: PointerEvent) => {
      const draft = drawingDraftRef.current;
      if (drawingToolRef.current === "TREND_LINE" && draft) {
        const initial = pointAt(event.clientX, event.clientY);
        if (!initial) return;
        let end = initial;
        const currentCoordinate = drawingDraftCoordinateRef.current;
        if (event.shiftKey && currentCoordinate) {
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
        if (event.shiftKey) coordinate = snapScreenPointTo45(otherCoordinate, coordinate);
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
      if (preview?.id === dragging.id) onUpdateTrendLineRef.current(preview.id, preview.geometry);
      dragging = null;
      requestAnimationFrame(() => commitPreview(null));
      if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
      setChartCursor("");
    };
    const cancelDrag = () => {
      dragging = null;
      commitPreview(null);
      setChartCursor(drawingToolRef.current ? "crosshair" : "");
    };
    const doubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const id = target.closest<SVGElement>("[data-drawing-id]")?.dataset.drawingId;
      if (!id || id.startsWith("temporary-")) return;
      stopEvent(event);
      onOpenTrendLineStyleRef.current(id);
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
        onDeleteTrendLineRef.current(selectedDrawingIdRef.current);
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
  }, [priceTickSize, setChartCursor, syncDrawingCoordinates]);

  useEffect(() => {
    if (drawingTool) {
      setChartCursor("crosshair");
      return;
    }
    if (drawingDraftRef.current) {
      drawingDraftRef.current = null;
      drawingDraftCoordinateRef.current = null;
      setDrawingDraft(null);
      setDrawingDraftCoordinate(null);
    }
    if (!measurementRef.current) setChartCursor("");
  }, [drawingTool, setChartCursor]);

  useEffect(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    let frame: number | null = null;
    const schedule = () => {
      if (!drawingsRef.current.length && !drawingDraftRef.current) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        syncDrawingCoordinates();
      });
    };
    interaction.addEventListener("wheel", schedule);
    interaction.addEventListener("pointermove", schedule);
    interaction.addEventListener("pointerup", schedule);
    return () => {
      interaction.removeEventListener("wheel", schedule);
      interaction.removeEventListener("pointermove", schedule);
      interaction.removeEventListener("pointerup", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [syncDrawingCoordinates]);

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
      if (!dragging) {
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
      if (dragging.target.kind === "draft") {
        setDraft((current) => {
          if (!current) return current;
          const next = moveDraftLine(current, dragging!.target.field, price);
          dragging!.previewPrice = next[dragging!.target.field as keyof DraftOrder] as number;
          return next;
        });
      } else {
        dragging.previewPrice = price;
        const rLabel = dragging.target.rReference ? formatRMultiple(rMultipleAtPrice(dragging.target.rReference, price)) : null;
        priceLinesRef.current.get(dragging.target.key)?.applyOptions({ price, ...(rLabel ? { title: rLabel } : {}) });
        setLineActions((current) => current.map((action) => action.key === dragging!.target.key ? { ...action, price, y, ...(rLabel ? { label: rLabel } : {}) } : action));
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
    interaction.addEventListener("pointerup", finish); interaction.addEventListener("pointerleave", leave); window.addEventListener("keydown", key);
    return () => {
      interaction.removeEventListener("pointerdown", down); interaction.removeEventListener("pointermove", move);
      interaction.removeEventListener("pointerup", finish); interaction.removeEventListener("pointerleave", leave); window.removeEventListener("keydown", key);
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
    requestAnimationFrame(syncDrawingCoordinates);
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
  const drawingPaneWidth = chartRef.current?.timeScale().width() ?? 0;
  const drawingPaneHeight = chartRef.current?.panes()[0]?.getHeight() ?? 0;
  const drawingPriceLabelStyle = (point: { x: number; y: number }) => ({
    left: Math.max(6, Math.min(point.x + 7, Math.max(6, drawingPaneWidth - 92))),
    top: Math.max(4, Math.min(point.y - 12, Math.max(4, drawingPaneHeight - 26))),
  });

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

      {(drawingCoordinates.length > 0 || drawingDraftCoordinate) && drawingPaneWidth > 0 && drawingPaneHeight > 0 ? (
        <div
          data-testid="chart-drawings"
          className="pointer-events-none absolute left-0 top-0 z-[15] overflow-hidden"
          style={{ width: drawingPaneWidth, height: drawingPaneHeight }}
        >
          <svg
            aria-label={copy.marketReplay.drawingObjects}
            className="absolute inset-0"
            width={drawingPaneWidth}
            height={drawingPaneHeight}
            viewBox={`0 0 ${drawingPaneWidth} ${drawingPaneHeight}`}
          >
            {drawingCoordinates.map(({ drawing, start, end }) => {
              const selected = selectedDrawingId === drawing.id;
              const opacity = drawing.style.opacity / 100;
              const dash = trendLineDashArray(drawing.style.lineStyle);
              return (
                <g key={drawing.id}>
                  {selected ? (
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="#fff"
                      strokeWidth={drawing.style.width + 3}
                      opacity={0.9}
                    />
                  ) : null}
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={drawing.style.color}
                    strokeWidth={drawing.style.width}
                    strokeDasharray={dash}
                    strokeLinecap="round"
                    opacity={opacity}
                  />
                  <line
                    data-drawing-id={drawing.id}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke="transparent"
                    strokeWidth="12"
                    strokeLinecap="round"
                    className="pointer-events-auto cursor-move"
                  />
                  {selected ? (
                    <>
                      <circle
                        data-drawing-id={drawing.id}
                        data-drawing-handle="start"
                        cx={start.x}
                        cy={start.y}
                        r="5"
                        fill="#fff"
                        stroke={drawing.style.color}
                        strokeWidth="2"
                        className="pointer-events-auto cursor-crosshair"
                      />
                      <circle
                        data-drawing-id={drawing.id}
                        data-drawing-handle="end"
                        cx={end.x}
                        cy={end.y}
                        r="5"
                        fill="#fff"
                        stroke={drawing.style.color}
                        strokeWidth="2"
                        className="pointer-events-auto cursor-crosshair"
                      />
                    </>
                  ) : null}
                </g>
              );
            })}
            {drawingDraftCoordinate ? (
              <line
                x1={drawingDraftCoordinate.start.x}
                y1={drawingDraftCoordinate.start.y}
                x2={drawingDraftCoordinate.end.x}
                y2={drawingDraftCoordinate.end.y}
                stroke="#2962FF"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : null}
          </svg>
          {drawingCoordinates.flatMap(({ drawing, start, end }) => {
            const labels: Array<{ key: string; point: { x: number; y: number }; price: number }> = [];
            if (drawing.style.showStartPrice) labels.push({ key: `${drawing.id}:start`, point: start, price: drawing.geometry.start.price });
            if (drawing.style.showEndPrice) labels.push({ key: `${drawing.id}:end`, point: end, price: drawing.geometry.end.price });
            return labels.map((label) => (
              <div
                key={label.key}
                className="absolute rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow-sm"
                style={{
                  ...drawingPriceLabelStyle(label.point),
                  backgroundColor: drawing.style.color,
                  opacity: drawing.style.opacity / 100,
                }}
              >
                {formatPriceForTick(label.price, priceTickSize)}
              </div>
            ));
          })}
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
