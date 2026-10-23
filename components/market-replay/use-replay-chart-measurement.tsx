"use client";

import { useEffect } from "react";
import { calculateChartMeasurement } from "@/lib/market-replay/chart-measurement";
import { snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { MeasurementPoint, MeasurementState } from "./replay-chart-shared";
import type { useReplayChartCore } from "./use-replay-chart-core";

export function useReplayChartMeasurement(core: ReturnType<typeof useReplayChartCore>) {
  const {
    containerRef, interactionRef, chartRef, candleRef, barsRef, measurementArmedRef,
    onMeasurementArmedChangeRef, drawingToolRef, setContextMenu, measurement, setMeasurement, measurementRef,
    drawingDraftRef, drawingDraftCoordinateRef, drawingPreviewRef, hasVolume, syncDrawingPrimitive, setChartCursor,
    priceTickSize, displayIntervalSeconds, measurementArmed, drawingTool,
  } = core;
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
  }, [drawingTool, setChartCursor, syncDrawingPrimitive, drawingDraftCoordinateRef, drawingDraftRef, measurementRef]);

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
        // Notify the latest callback when the measurement listener is removed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        onMeasurementArmedChangeRef.current(false);
      }
      setCrosshairVisible(true);
      setChartCursor("");
    };
  }, [displayIntervalSeconds, hasVolume, priceTickSize, setChartCursor, barsRef, candleRef, chartRef, containerRef, drawingDraftRef, drawingPreviewRef, drawingToolRef, interactionRef, measurementArmedRef, measurementRef, onMeasurementArmedChangeRef, setContextMenu, setMeasurement]);

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
  }, [measurementArmed, setChartCursor, chartRef, measurementRef, setMeasurement]);

  useEffect(() => {
    if (!measurement) setChartCursor(measurementArmed ? "crosshair" : "");
  }, [measurement, measurementArmed, setChartCursor]);

}
