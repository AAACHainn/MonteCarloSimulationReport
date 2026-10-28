"use client";
import { ArrowPrimitive } from "@/lib/market-replay/arrow-primitive";

import { syncPriceLine } from "@/lib/market-replay/price-lines";
import { canUpdateReplayTail, formatChartTick, chartCandleData as candle, chartVolumeData as volume } from "@/lib/market-replay/chart-data";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, type IChartApi, type Time, TickMarkType } from "lightweight-charts";
import { copy } from "@/lib/i18n";
import { defaultReplayLogicalRange, captureReplayViewport, isReplayRangeFollowing, rangeForReplayViewport, rangeAfterNewReplayBar, rangeAfterWindowReplacement, rangeForReplayFocus, type ReplayLogicalRange } from "@/lib/market-replay/chart-range";
import { candlestickSeriesStyleOptions } from "@/lib/market-replay/candlestick-style";
import { RectanglePrimitive } from "@/lib/market-replay/rectangle-primitive";
import { TrendLinePrimitive } from "@/lib/market-replay/trend-line-primitive";
import { FibonacciRetracementPrimitive } from "@/lib/market-replay/fibonacci-retracement-primitive";
import { TextDrawingPrimitive } from "@/lib/market-replay/text-drawing-primitive";
import { formatUtcDateTime } from "@/lib/market-replay/display-timezone";
import { priceDecimalsForTick, snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { ReplayTradeAnnotationPrimitive } from "@/lib/market-replay/trade-annotation-primitive";
import { BarCountPrimitive } from "@/lib/market-replay/bar-count-primitive";
import { CandleCountdownPrimitive } from "@/lib/market-replay/candle-countdown-primitive";
import { calculateRiskSizing, orderTypeForEntry, targetPriceForR } from "@/lib/paper-trading/risk-sizing";
import { createBracketRReference, protectiveOrderRReference } from "@/lib/paper-trading/line-r-multiple";
import { useReplayChartEma } from "./use-replay-chart-ema";
import { chartHiddenSeriesData } from "@/lib/market-replay/chart-hide-after";
import { DraftOrder, LineTarget, LineAction, sameLineActions, number, orderTypeLabel, bracketPriceLineTitle } from "./replay-chart-shared";
import type { useReplayChartCore } from "./use-replay-chart-core";

export function useReplayChartSetup(core: ReturnType<typeof useReplayChartCore>) {
  const {
    viewportModeRef, viewportGestureRef, viewportUpdatingRef, pendingFollowRef, liveWindowRef, currentSourceSequenceRef, viewportSnapshot,
    visibilityScope, hiddenAfter, visibleBars, visibleWarmupBars, containerRef, chartRef,
    candleRef, volumeRef, priceLinesRef, lineTargetsRef, tradeAnnotationPrimitiveRef, barCountPrimitiveRef,
    candleCountdownPrimitiveRef, rectanglePrimitiveRef, trendLinePrimitiveRef, fibonacciPrimitiveRef, textPrimitiveRef, textEditRef,
    textPositionRef, textDragRef, arrowPrimitiveRef, arrowDragRef, lastDataRef, lastDataRevisionRef, lastHiddenAfterRef, lastDataIntervalRef,
    lastDataSessionRef, displaySessionRef, barsRef, timelineBarsRef, projectionBars, projectionBarsRef,
    drawingScopeRef, drawingFrameRef, drawingSessionRef, requestedDrawingSessionRef, onFocusAppliedRef, tradeAnnotationsRef,
    tradeAnnotationsVisibleRef, candlestickStyleRef, displayIntervalSecondsRef, requestedDisplayIntervalSecondsRef, gridVisibleRef, draft,
    setLineActions, hasVolume, currentPriceRef, displayUtcOffsetRef, syncLineActionCoordinates, syncDrawingPrimitive,
    syncMeasurementCoordinates, syncVisibleSequenceRange, restoreCrosshair, setChartCursor, dataRevision, priceTickSize, bars,
    displayUtcOffsetMinutes, displayIntervalSeconds, candlestickStyle, gridVisible, trendLineDraftStyle, fibonacciDraftStyle,
    rectangleDraftStyle, emaEnabled, emaIndicators, volumeVisible, displaySession, barCountSession,
    barCountConfig, paperSnapshot, tradeAnnotations, focusSequence, tradeAnnotationsVisible, candleCountdownEnabled,
    playbackActive, currentSourceTimestamp, sourceIntervalSeconds, readOnly,
  } = core;
  const viewportBeforeEmaResetRef = useRef<{ chart: IChartApi; range: ReplayLogicalRange | null } | null>(null);
  const captureViewportBeforeEmaReset = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // EMA placeholders can insert/remove a time point before the candle data effect.
    // Preserve the range in the old candle coordinates, once for all EMA lines.
    if (viewportBeforeEmaResetRef.current?.chart !== chart) {
      viewportBeforeEmaResetRef.current = { chart, range: chart.timeScale().getVisibleLogicalRange() };
    }
    viewportUpdatingRef.current = true;
  }, [chartRef, viewportUpdatingRef]);
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
        borderColor: "#e2e8f0",
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
    const textPrimitive = new TextDrawingPrimitive();
    const arrowPrimitive = new ArrowPrimitive();
    const tradeAnnotationPrimitive = new ReplayTradeAnnotationPrimitive();
    const barCountPrimitive = new BarCountPrimitive();
    const candleCountdownPrimitive = new CandleCountdownPrimitive();
    const rectanglePrimitive = new RectanglePrimitive();
    candles.attachPrimitive(rectanglePrimitive);
    candles.attachPrimitive(trendLinePrimitive);
    candles.attachPrimitive(fibonacciPrimitive);
    candles.attachPrimitive(textPrimitive);
    candles.attachPrimitive(arrowPrimitive);
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
        syncDrawingPrimitive();
      }
    });
    observer.observe(container);
    let pointerActive = false;
    let gestureTimer: ReturnType<typeof setTimeout> | undefined;
    const endGesture = () => {
      if (!pointerActive && !viewportGestureRef.current) return;
      pointerActive = false;
      if (gestureTimer) clearTimeout(gestureTimer);
      gestureTimer = setTimeout(() => { syncVisibleSequenceRange(); viewportGestureRef.current = false; }, 160);
    };
    const startGesture = (event: PointerEvent | WheelEvent) => {
      const x = event.clientX - container.getBoundingClientRect().left;
      if (x < 0 || x > chart.timeScale().width()) return;
      if (gestureTimer) clearTimeout(gestureTimer);
      viewportGestureRef.current = true;
      if (event.type === "pointerdown") pointerActive = true;
      else if (!pointerActive) endGesture();
    };
    container.addEventListener("pointerdown", startGesture, true);
    container.addEventListener("wheel", startGesture, { capture: true, passive: true });
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncMeasurementCoordinates);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncVisibleSequenceRange);
    const syncTextPosition = () => { if (textPositionRef.current) syncDrawingPrimitive(); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncTextPosition);
    container.addEventListener("wheel", syncTextPosition, { passive: true });
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = null;
    restoreCrosshair();
    setChartCursor("");
    rectanglePrimitiveRef.current = rectanglePrimitive;
    trendLinePrimitiveRef.current = trendLinePrimitive;
    fibonacciPrimitiveRef.current = fibonacciPrimitive;
    textPrimitiveRef.current = textPrimitive;
    arrowPrimitiveRef.current = arrowPrimitive;
    tradeAnnotationPrimitiveRef.current = tradeAnnotationPrimitive;
    barCountPrimitiveRef.current = barCountPrimitive;
    candleCountdownPrimitiveRef.current = candleCountdownPrimitive;
    syncDrawingPrimitive();
    return () => {
      if (drawingFrameRef.current !== null) {
        cancelAnimationFrame(drawingFrameRef.current);
        drawingFrameRef.current = null;
      }
      if (gestureTimer) clearTimeout(gestureTimer);
      viewportGestureRef.current = false;
      container.removeEventListener("pointerdown", startGesture, true);
      container.removeEventListener("wheel", startGesture, true);
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncLineActionCoordinates);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMeasurementCoordinates);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncVisibleSequenceRange);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncTextPosition);
      container.removeEventListener("wheel", syncTextPosition);
      candles.detachPrimitive(rectanglePrimitive);
      candles.detachPrimitive(trendLinePrimitive);
      candles.detachPrimitive(fibonacciPrimitive);
      candles.detachPrimitive(textPrimitive);
      candles.detachPrimitive(arrowPrimitive);
      arrowPrimitiveRef.current = null; arrowDragRef.current = null;
      candles.detachPrimitive(tradeAnnotationPrimitive);
      candles.detachPrimitive(barCountPrimitive);
      candles.detachPrimitive(candleCountdownPrimitive);
      rectanglePrimitiveRef.current = null;
      trendLinePrimitiveRef.current = null;
      fibonacciPrimitiveRef.current = null;
      textPrimitiveRef.current = null; textEditRef.current = null; textDragRef.current = null;
      tradeAnnotationPrimitiveRef.current = null;
      barCountPrimitiveRef.current = null;
      candleCountdownPrimitiveRef.current = null;
      chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      priceLines.clear(); lineTargets.clear(); lastDataRef.current = [];
    };
  }, [arrowPrimitiveRef, arrowDragRef, priceTickSize, restoreCrosshair, setChartCursor, syncDrawingPrimitive, syncLineActionCoordinates, syncMeasurementCoordinates, syncVisibleSequenceRange, barCountPrimitiveRef, barsRef, candleCountdownPrimitiveRef, candleRef, candlestickStyleRef, chartRef, containerRef, displayUtcOffsetRef, drawingFrameRef, fibonacciPrimitiveRef, gridVisibleRef, lastDataRef, lineTargetsRef, priceLinesRef, rectanglePrimitiveRef, textDragRef, textEditRef, textPositionRef, textPrimitiveRef, tradeAnnotationPrimitiveRef, tradeAnnotationsRef, tradeAnnotationsVisibleRef, trendLinePrimitiveRef, volumeRef, viewportGestureRef]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: { vertLines: { visible: gridVisible }, horzLines: { visible: gridVisible } },
    });
  }, [gridVisible, chartRef]);

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
  }, [hasVolume, volumeVisible, barsRef, chartRef, volumeRef]);

  useEffect(() => {
    candleRef.current?.applyOptions(candlestickSeriesStyleOptions(candlestickStyle));
  }, [candlestickStyle, candleRef]);

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
  }, [displayUtcOffsetMinutes, chartRef, displayUtcOffsetRef]);

  useEffect(() => {
    syncDrawingPrimitive();
  }, [fibonacciDraftStyle, rectangleDraftStyle, syncDrawingPrimitive, trendLineDraftStyle]);

  useEffect(() => {
    const chart = chartRef.current; const series = candleRef.current;
    if (!chart || !series) return;
    const beforeReset = viewportBeforeEmaResetRef.current;
    viewportBeforeEmaResetRef.current = null;
    const previousRange = beforeReset?.chart === chart ? beforeReset.range : chart.timeScale().getVisibleLogicalRange();
    const nextDisplayIntervalSeconds = requestedDisplayIntervalSecondsRef.current;
    const nextDisplaySession = displaySessionRef.current;
    const previous = lastDataRef.current;
    const next = bars;
    const timelineChanged = lastDataIntervalRef.current !== nextDisplayIntervalSeconds
      || lastDataSessionRef.current !== nextDisplaySession;
    const transitionViewport = timelineChanged ? viewportSnapshot ?? captureReplayViewport({
      visibleRange: previousRange, bars: previous,
      sourceSequence: currentSourceSequenceRef.current ?? previous.at(-1)?.lastSequence ?? -1,
      liveWindow: liveWindowRef.current, mode: readOnly ? "history" : viewportModeRef.current,
      chartWidth: chart.timeScale().width(), barSpacing: chart.timeScale().options().barSpacing,
    }) : null;
    viewportUpdatingRef.current = true;
    const following = viewportModeRef.current === "following" || (viewportModeRef.current === null
      && isReplayRangeFollowing(previousRange ?? { from: 0, to: 0 }, previous.length - 1));
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
    if (samePrefix && !timelineChanged && !hiddenAfter && !lastHiddenAfterRef.current) {
      const range = previousRange;
      const previousLastIndex = previous.length - 1;
      for (const bar of next.slice(Math.max(0, previous.length - 1))) {
        series.update(candle(bar)); if (bar.volume !== null) volumeSeries?.update(volume(bar));
      }
      if (range && next.length > previous.length && !readOnly) {
        chart.timeScale().setVisibleLogicalRange(rangeAfterNewReplayBar(range, previousLastIndex, next.length - previous.length, following && liveWindowRef.current));
      }
    } else {
      const range = previousRange;
      const previousLastIndex = previous.length - 1;
      const previousLastInNext = next.findIndex((bar) => bar.timestamp === previous.at(-1)?.timestamp);
      const mappedTimelineRange = transitionViewport
        ? rangeForReplayViewport(transitionViewport, next, nextDisplayIntervalSeconds, chart.timeScale().width()) : null;
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
        const advanced = readOnly ? range : rangeAfterNewReplayBar(range, previousLastIndex, next.length - 1 - previousLastInNext, following && liveWindowRef.current);
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
    if (pendingFollowRef.current && next.length) {
      const range = chart.timeScale().getVisibleLogicalRange();
      const span = range ? range.to - range.from : 200;
      const from = next.length - 1 - span * 0.618;
      chart.timeScale().setVisibleLogicalRange({ from, to: from + span });
      pendingFollowRef.current = false;
      viewportModeRef.current = "following";
    } else if (!previous.length && next.length) viewportModeRef.current = "following";
    else if (timelineChanged) viewportModeRef.current = transitionViewport?.mode ?? (following ? "following" : "history");
    // A new display period gets a fresh vertical fit; ordinary updates keep manual scaling.
    if (timelineChanged) {
      series.priceScale().applyOptions({ autoScale: true });
      volumeSeries?.priceScale().applyOptions({ autoScale: true });
    } else if (!candleWasAutoScaled && series.priceScale().options().autoScale) {
      series.priceScale().applyOptions({ autoScale: false });
    }
    if (!timelineChanged && volumeSeries && !volumeWasAutoScaled && volumeSeries.priceScale().options().autoScale) {
      volumeSeries.priceScale().applyOptions({ autoScale: false });
    }
    lastDataRef.current = next;
    lastDataRevisionRef.current = dataRevision;
    lastHiddenAfterRef.current = hiddenAfter;
    lastDataIntervalRef.current = nextDisplayIntervalSeconds;
    lastDataSessionRef.current = nextDisplaySession;
    requestAnimationFrame(() => {
      viewportUpdatingRef.current = false;
      syncVisibleSequenceRange();
    });
    requestAnimationFrame(syncMeasurementCoordinates);
    syncDrawingPrimitive();
  }, [bars, dataRevision, projectionBars, visibleBars, hiddenAfter, readOnly, visibilityScope, displayIntervalSeconds, displaySession, barCountSession, sourceIntervalSeconds, syncDrawingPrimitive, syncMeasurementCoordinates, syncVisibleSequenceRange, barsRef, candleRef, chartRef, displayIntervalSecondsRef, displaySessionRef, drawingScopeRef, drawingSessionRef, lastDataIntervalRef, lastDataRef, lastDataRevisionRef, lastDataSessionRef, lastHiddenAfterRef, projectionBarsRef, requestedDisplayIntervalSecondsRef, requestedDrawingSessionRef, timelineBarsRef, volumeRef, viewportModeRef, viewportUpdatingRef, pendingFollowRef, liveWindowRef, currentSourceSequenceRef, viewportSnapshot]);

  useEffect(() => {
    if (focusSequence === null) return;
    const chart = chartRef.current;
    if (!chart) return;
    const range = rangeForReplayFocus(bars, focusSequence, chart.timeScale().getVisibleLogicalRange());
    if (!range) return;
    viewportModeRef.current = "history";
    chart.timeScale().setVisibleLogicalRange(range);
    onFocusAppliedRef.current?.();
  }, [bars, focusSequence, chartRef, onFocusAppliedRef, viewportModeRef]);

  useEffect(() => {
    tradeAnnotationPrimitiveRef.current?.setData({
      entries: tradeAnnotationsVisible ? tradeAnnotations : [],
      bars: visibleBars,
    });
  }, [visibleBars, tradeAnnotations, tradeAnnotationsVisible, tradeAnnotationPrimitiveRef]);

  useEffect(() => {
    barCountPrimitiveRef.current?.setData({
      bars: visibleBars,
      displaySession,
      displayIntervalSeconds,
      session: barCountSession,
      config: barCountConfig,
    });
  }, [barCountConfig, barCountSession, visibleBars, displayIntervalSeconds, displaySession, barCountPrimitiveRef]);

  useEffect(() => {
    candleCountdownPrimitiveRef.current?.setData({
      bars: visibleBars,
      currentSourceTimestamp,
      enabled: candleCountdownEnabled && !hiddenAfter,
      playing: playbackActive,
      sourceIntervalSeconds: sourceIntervalSeconds ?? displayIntervalSeconds,
    });
  }, [visibleBars, hiddenAfter, candleCountdownEnabled, currentSourceTimestamp, displayIntervalSeconds, playbackActive, sourceIntervalSeconds, candleCountdownPrimitiveRef]);

  useReplayChartEma({
    chartRef,
    bars: visibleBars,
    warmupBars: visibleWarmupBars,
    timelineBars: bars,
    onBeforeTimelineReset: captureViewportBeforeEmaReset,
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
  }, [draft, paperSnapshot, priceTickSize, candleRef, lineTargetsRef, priceLinesRef, setLineActions]);

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
  }, [priceTickSize, currentPriceRef]);

  return {
    draftSizing, moveDraftLine,
  };
}
