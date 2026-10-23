"use client";

import { useEffect } from "react";
import { snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { AbrTooltipState, LineTarget, abrValueAt, bracketPriceLineTitle } from "./replay-chart-shared";
import type { useReplayChartCore } from "./use-replay-chart-core";
import type { useReplayChartSetup } from "./use-replay-chart-setup";

export function useReplayChartOrderInteractions(core: ReturnType<typeof useReplayChartCore>, setup: ReturnType<typeof useReplayChartSetup>) {
  const {
    containerRef, interactionRef, chartRef, candleRef, priceLinesRef, lineTargetsRef,
    barsRef, measurementArmedRef, drawingToolRef, setContextMenu, setAbrTooltip, measurementRef,
    drawingDraftRef, drawingPreviewRef, setDraft, setLineActions, warmupBarsRef, abrLengthRef,
    onOrderPriceChangeRef, syncLineActionCoordinates, setChartCursor, priceTickSize, abrEnabled, paperBusy,
    entryCheckOpen,
  } = core;
  const {
    moveDraftLine,
  } = setup;
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
      if (target.closest("button,input,textarea,[data-text-editor],[data-context-menu],[data-order-ticket],[data-line-action]") || nearOrderLine(event.clientY)) return;
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
  }, [abrEnabled, priceTickSize, abrLengthRef, barsRef, candleRef, chartRef, containerRef, drawingDraftRef, drawingPreviewRef, drawingToolRef, interactionRef, lineTargetsRef, measurementArmedRef, measurementRef, setAbrTooltip, setContextMenu, warmupBarsRef]);

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
      if ((event.target as HTMLElement | null)?.closest("button,input,textarea,[data-text-editor],[data-context-menu]")) return;
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
  }, [entryCheckOpen, paperBusy, moveDraftLine, priceTickSize, setChartCursor, syncLineActionCoordinates, candleRef, containerRef, drawingDraftRef, drawingPreviewRef, drawingToolRef, interactionRef, lineTargetsRef, measurementArmedRef, onOrderPriceChangeRef, priceLinesRef, setContextMenu, setDraft, setLineActions]);

}
