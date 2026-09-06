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
  datasetId, priceTickSize, bars, warmupBars, displayUtcOffsetMinutes, emaEnabled, emaIndicators, paperSnapshot,
  paperBusy, paperError, onSubmitOrder, onOrderPriceChange,
  onCancelOrder, onClosePosition, onDraftActiveChange, onOpenPaperAccount,
}: {
  datasetId: string;
  priceTickSize: number;
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  displayUtcOffsetMinutes: number;
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
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
      }
    });
    observer.observe(container);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = volumes;
    markersRef.current = createSeriesMarkers(candles, []);
    return () => {
      observer.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
      chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      markersRef.current = null; priceLines.clear(); lineTargets.clear(); emaSeries.clear(); emaStates.clear(); lastDataRef.current = [];
    };
  }, [hasVolume, priceTickSize, syncLineActionCoordinates]);

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
  }, [bars]);

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
    const container = containerRef.current; const interaction = interactionRef.current; const series = candleRef.current;
    if (!container || !interaction || !series) return;
    let dragging: { target: LineTarget; originalPrice: number; previewPrice: number } | null = null;
    const setLineCursor = (cursor: "" | "ns-resize") => {
      container.style.cursor = cursor;
      container.querySelectorAll("canvas").forEach((canvas) => { canvas.style.cursor = cursor; });
    };
    const nearestLine = (y: number) => [...lineTargetsRef.current.values()]
      .map((target) => ({ target, coordinate: series.priceToCoordinate(target.price) }))
      .filter((item) => item.coordinate !== null)
      .sort((a, b) => Math.abs(Number(a.coordinate) - y) - Math.abs(Number(b.coordinate) - y))[0];
    const down = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest("button,input,[data-context-menu]")) return;
      const y = event.clientY - container.getBoundingClientRect().top;
      const dragKey = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-line-drag-key]")?.dataset.lineDragKey;
      const directTarget = dragKey ? lineTargetsRef.current.get(dragKey) : undefined;
      const candidate = directTarget ? { target: directTarget, coordinate: series.priceToCoordinate(directTarget.price) } : nearestLine(y);
      if (!candidate || candidate.coordinate === null || (!directTarget && Math.abs(Number(candidate.coordinate) - y) > 8)) return;
      event.preventDefault(); setLineCursor("ns-resize"); setContextMenu(null);
      dragging = { target: candidate.target, originalPrice: candidate.target.price, previewPrice: candidate.target.price };
      interaction.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const y = event.clientY - container.getBoundingClientRect().top;
      if (!dragging) {
        const candidate = nearestLine(y);
        setLineCursor(candidate && Math.abs(Number(candidate.coordinate) - y) <= 8 ? "ns-resize" : "");
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
      const value = dragging; dragging = null; setLineCursor("");
      if (value.target.kind === "order" && value.target.orderId && value.previewPrice !== value.originalPrice) {
        void onOrderPriceChangeRef.current(value.target.orderId, { [value.target.field]: value.previewPrice });
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragging) {
        if (dragging.target.kind === "order") priceLinesRef.current.get(dragging.target.key)?.applyOptions({ price: dragging.originalPrice });
        dragging = null; setLineCursor(""); syncLineActionCoordinates();
      }
    };
    const leave = () => { if (!dragging) setLineCursor(""); };
    interaction.addEventListener("pointerdown", down); interaction.addEventListener("pointermove", move);
    interaction.addEventListener("pointerup", finish); interaction.addEventListener("pointerleave", leave); window.addEventListener("keydown", key);
    return () => {
      interaction.removeEventListener("pointerdown", down); interaction.removeEventListener("pointermove", move);
      interaction.removeEventListener("pointerup", finish); interaction.removeEventListener("pointerleave", leave); window.removeEventListener("keydown", key);
      setLineCursor("");
    };
  }, [moveDraftLine, priceTickSize, syncLineActionCoordinates]);

  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
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
