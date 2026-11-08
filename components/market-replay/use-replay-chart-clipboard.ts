"use client";

import { useEffect } from "react";
import { anchorForLogicalIndex } from "@/lib/market-replay/chart-drawings";
import { positionDrawingCopy } from "@/lib/market-replay/drawing-clipboard";
import { snapPriceToTick } from "@/lib/market-replay/price-ticks";
import type { useReplayChartCore } from "./use-replay-chart-core";

/** Track only the pointer. Resolve the current chart coordinates synchronously
 * when paste is pressed, so zoom/replay/layout changes cannot stale placement. */
export function useReplayChartClipboard(core: ReturnType<typeof useReplayChartCore>) {
  const { containerRef, interactionRef, chartRef, candleRef, positionCopyRef, drawingTimelineRef, barsRef,
    displayIntervalSecondsRef, sourceIntervalSecondsRef, drawingSessionRef, visibilityScope, priceTickSize } = core;
  useEffect(() => {
    const host = interactionRef.current, container = containerRef.current, chart = chartRef.current, series = candleRef.current;
    if (!host || !container || !chart || !series) return;
    let pointer: { x: number; y: number } | null = null;
    const move = (event: PointerEvent) => { if (event.pointerType === "mouse") pointer = { x: event.clientX, y: event.clientY }; };
    const leave = () => { pointer = null; };
    positionCopyRef.current = source => {
      if (!pointer) return null;
      const rect = container.getBoundingClientRect(), x = pointer.x - rect.left, y = pointer.y - rect.top;
      if (x < 0 || x >= chart.timeScale().width() || y < 0 || y >= (chart.panes()[0]?.getHeight() ?? 0)) return null;
      const element = document.elementFromPoint(pointer.x, pointer.y);
      if (!element || !container.contains(element) || element.closest("button,input,textarea,[data-text-editor],[data-context-menu],[data-order-ticket],[data-line-action]")) return null;
      const logical = chart.timeScale().coordinateToLogical(x as never), rawPrice = series.coordinateToPrice(y as never);
      if (logical === null || rawPrice === null) return null;
      const price = snapPriceToTick(Number(rawPrice), priceTickSize);
      return positionDrawingCopy(source, { logicalIndex: Number(logical), price }, drawingTimelineRef.current, (index, anchorPrice) => {
        if (!Number.isSafeInteger(index) || drawingTimelineRef.current.timestampForLogicalIndex(index) === null) return null;
        return anchorForLogicalIndex({ logicalIndex: index, price: anchorPrice, bars: barsRef.current,
          displayIntervalSeconds: displayIntervalSecondsRef.current, sourceIntervalSeconds: sourceIntervalSecondsRef.current,
          session: drawingSessionRef.current, timeline: drawingTimelineRef.current });
      });
    };
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerdown", move, true);
    host.addEventListener("pointerleave", leave); window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerdown", move, true);
      host.removeEventListener("pointerleave", leave); window.removeEventListener("blur", leave);
      positionCopyRef.current = null;
    };
  }, [visibilityScope, containerRef, interactionRef, chartRef, candleRef, positionCopyRef, drawingTimelineRef,
    barsRef, displayIntervalSecondsRef, sourceIntervalSecondsRef, drawingSessionRef, priceTickSize]);
}
