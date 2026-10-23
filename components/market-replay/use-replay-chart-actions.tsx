"use client";

import { createUuid } from "@/lib/uuid";

import { type MouseEvent as ReactMouseEvent } from "react";
import { copy } from "@/lib/i18n";
import { defaultReplayLogicalRange } from "@/lib/market-replay/chart-range";
import { calculateChartMeasurementGeometry, measurementDurationParts } from "@/lib/market-replay/chart-measurement";
import { snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { orderTypeForEntry, targetPriceForR } from "@/lib/paper-trading/risk-sizing";
import type { PaperSide } from "@/lib/paper-trading/types";
import { chartRewindTarget } from "@/lib/market-replay/chart-rewind";
import { chartHideAfterTarget } from "@/lib/market-replay/chart-hide-after";
import type { useReplayChartCore } from "./use-replay-chart-core";
import type { useReplayChartSetup } from "./use-replay-chart-setup";

export function useReplayChartActions(core: ReturnType<typeof useReplayChartCore>, setup: ReturnType<typeof useReplayChartSetup>) {
  const {
    replaySession, chartRef, candleRef, volumeRef, barsRef, drawingToolRef,
    contextMenu, setContextMenu, measurement, drawingDraftRef, drawingPreviewRef, draft,
    setDraft, setOrderTicketPosition, defaultRiskAmount, setDefaultRiskAmount, defaultTargetR, setDefaultTargetR,
    setDefaultSaved, setDraftError, latest, currentPrice, syncLineActionCoordinates, syncDrawingPrimitive,
    datasetId, priceTickSize, bars, displayIntervalSeconds, displaySession, paperSnapshot,
    readOnly, paperBusy, onSubmitOrder, entryCheckOpen, onRewindToBar, rewindRange,
  } = core;
  const {
    draftSizing,
  } = setup;
  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (drawingToolRef.current || drawingDraftRef.current || drawingPreviewRef.current) return;
    if ((event.target as HTMLElement).closest("[data-text-editor],[data-order-ticket],[data-context-menu],[data-line-action],[data-hidden-bars-notice]")) return;
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
  return {
    openContextMenu, resetChartView, createDraft, setDraftPrice, setTargetR, saveDefaults,
    submitDraft, contextEntryOrderTypes, measurementColor, measurementGeometry, measurementDuration, measurementLabelLeft,
    measurementLabelTop,
  };
}
