"use client";
import { isArrowDrawing, isArrowDrawingType, type AbcdGeometry, type ArrowGeometry } from "@/lib/market-replay/chart-drawings";
import { advanceAbcdDraft, moveAbcdGeometry, previewAbcdDraft, type AbcdCoordinates, type AbcdHitPart } from "@/lib/market-replay/abcd-interaction";

import { useEffect } from "react";
import { anchorForLogicalIndex, DRAWING_TYPE_FIB_RETRACEMENT, DRAWING_TYPE_TREND_LINE, DRAWING_TYPE_RECTANGLE, DRAWING_TYPE_TEXT, type TextGeometry, isValidRectangleGeometry, snapScreenPointTo45, type DrawingAnchor, type MarketDrawing, type TrendLineGeometry } from "@/lib/market-replay/chart-drawings";
import { resizeRectangleGeometry, type RectangleHandle } from "@/lib/market-replay/rectangle-primitive";
import { textPointerMoved } from "./text-inline-editor-events";
import { snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { hasVisibleReplayDialog, isReplayDrawingDeleteShortcut, isReplayShortcutInputTarget } from "@/lib/market-replay/keyboard-shortcuts";
import { DrawingDraft, DrawingSegmentCoordinate } from "./replay-chart-shared";
import type { useReplayChartCore } from "./use-replay-chart-core";

export function useReplayChartDrawingPointer(core: ReturnType<typeof useReplayChartCore>) {
  const {
    visibilityScope, containerRef, interactionRef, chartRef, candleRef, lineTargetsRef,
    rectanglePrimitiveRef, trendLinePrimitiveRef, fibonacciPrimitiveRef, textPrimitiveRef, textEditRef, textClicks,
    textDragRef, onPlaceTextRef, arrowPrimitiveRef, arrowDragRef, onPlaceArrowRef,
    abcdPrimitiveRef, abcdDraftRef, abcdPreviewRef, onCreateAbcdRef, barsRef, drawingTimelineRef, drawingSessionRef, measurementArmedRef,
    drawingToolRef, drawingsRef, drawingGroupsRef, selectedDrawingIdRef, onDrawingToolChangeRef, onSelectedDrawingIdChangeRef,
    onCreateDrawingRef, onUpdateDrawingRef, onDeleteDrawingRef, onOpenDrawingStyleRef, displayIntervalSecondsRef, sourceIntervalSecondsRef,
    setContextMenu, drawingDraftRef, drawingDraftCoordinateRef, drawingPreviewRef, syncDrawingPrimitive,
    setChartCursor, priceTickSize,
  } = core;
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
    let textDragging: { id: string; clientX: number; clientY: number; timeStamp: number; geometry: TextGeometry; x: number; y: number; moved: boolean } | null = null;
    let capturedPointer: number | null = null;
    let arrowDragging: { id: string; clientX: number; clientY: number; geometry: ArrowGeometry; x: number; y: number; moved: boolean } | null = null;
    let abcdDragging: { id: string; clientX: number; clientY: number; geometry: AbcdGeometry; coordinates: AbcdCoordinates; part: AbcdHitPart } | null = null;
    let abcdReleaseFrame: number | null = null;
    let hoveredText: string | null = null;
    const hoverText = (id: string | null) => {
      textPrimitiveRef.current?.setHovered(id);
      if (hoveredText !== id) { hoveredText = id; if (!dragging && !textDragging && !arrowDragging && !abcdDragging) setChartCursor(id ? "pointer" : ""); }
    };

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
      const text = textPrimitiveRef.current?.hitTestAt(point) ?? null;
      const arrow = arrowPrimitiveRef.current?.hitTestAt(point) ?? null;
      const abcd = abcdPrimitiveRef.current?.hitTestAt(point) ?? null;
      return [trend, fibonacci, rectangle, text, arrow, abcd].filter(item => item !== null)
        .sort((a, b) => b.priority - a.priority || Number(b.part === "text") - Number(a.part === "text") || a.distance - b.distance)[0] ?? null;
    };
    const drawingCoordinates = (drawing: MarketDrawing) => (
      drawing.type === DRAWING_TYPE_RECTANGLE ? rectanglePrimitiveRef.current?.getDrawingCoordinates(drawing.id)
        : drawing.type === DRAWING_TYPE_TREND_LINE
        ? trendLinePrimitiveRef.current?.getDrawingCoordinates(drawing.id)
        : drawing.type === DRAWING_TYPE_FIB_RETRACEMENT ? fibonacciPrimitiveRef.current?.getDrawingCoordinates(drawing.id) : null
    );

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !interaction.contains(event.target as Node)) return;
      const target = event.target as HTMLElement;
      if (target.closest("button,input,textarea,[data-text-editor],[data-context-menu],[data-order-ticket],[data-line-action]")) return;

      if (drawingToolRef.current) {
        const activeTool = drawingToolRef.current;
        const initial = pointAt(event.clientX, event.clientY);
        if (!initial) return;
        stopEvent(event);
        if (activeTool === "AB_CD") {
          clearPointerFrame();
          if (!abcdDraftRef.current) { drawingDraftRef.current = null; drawingDraftCoordinateRef.current = null; }
          const next = advanceAbcdDraft(abcdDraftRef.current, initial.anchor);
          abcdDraftRef.current = next.draft;
          if (next.complete) {
            drawingToolRef.current = null; onDrawingToolChangeRef.current(null);
            onCreateAbcdRef.current?.(next.complete); setChartCursor("");
          } else { onSelectedDrawingIdChangeRef.current(null); setChartCursor("crosshair"); }
          syncDrawingPrimitive(); return;
        }
        if (isArrowDrawingType(activeTool)) {
          commitDraft(null, null); drawingToolRef.current = null; onDrawingToolChangeRef.current(null);
          onPlaceArrowRef.current?.(activeTool, initial.anchor); setChartCursor(""); return;
        }
        if (activeTool === DRAWING_TYPE_TEXT) {
          const height = chart.panes()[0]?.getHeight() ?? 0;
          if (initial.coordinate.y > height) return;
          commitDraft(null, null); drawingToolRef.current = null; onDrawingToolChangeRef.current(null);
          onPlaceTextRef.current?.(initial.anchor); setChartCursor(""); return;
        }
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
      if (drawing?.type === "AB_CD") {
        const coordinates = abcdPrimitiveRef.current?.getDrawingCoordinates(id);
        if (!coordinates || id.startsWith("temporary-")) return;
        if ([...lineTargetsRef.current.values()].some(target => {
          const y = series.priceToCoordinate(target.price); return y !== null && Math.abs(Number(y) - (event.clientY - rect.top)) <= 8;
        })) return;
        if (abcdReleaseFrame !== null) { cancelAnimationFrame(abcdReleaseFrame); abcdReleaseFrame = null; }
        abcdPreviewRef.current = null;
        stopEvent(event); onSelectedDrawingIdChangeRef.current(id); selectedDrawingIdRef.current = id;
        abcdDragging = { id, clientX: event.clientX, clientY: event.clientY, geometry: drawing.geometry, coordinates, part: hit.part as AbcdHitPart };
        capturedPointer = event.pointerId; interaction.setPointerCapture(event.pointerId);
        chart.applyOptions({ handleScroll: false }); setChartCursor(hit.part === "line" ? "move" : "crosshair"); return;
      }
      if (drawing && isArrowDrawing(drawing)) {
        const coordinate = arrowPrimitiveRef.current?.getDrawingCoordinates(id);
        if (!coordinate || id.startsWith("temporary-")) return;
        // Existing order controls retain priority over annotations at the same price.
        if ([...lineTargetsRef.current.values()].some(target => {
          const y = series.priceToCoordinate(target.price); return y !== null && Math.abs(Number(y) - (event.clientY - rect.top)) <= 8;
        })) return;
        stopEvent(event); onSelectedDrawingIdChangeRef.current(id); selectedDrawingIdRef.current = id;
        arrowDragging = { id, clientX: event.clientX, clientY: event.clientY, geometry: drawing.geometry,
          x: coordinate.x, y: coordinate.y, moved: false };
        capturedPointer = event.pointerId; interaction.setPointerCapture(event.pointerId);
        chart.applyOptions({ handleScroll: false }); setChartCursor("move"); return;
      }
      if (drawing?.type === DRAWING_TYPE_TEXT) {
        const textCoordinate = textPrimitiveRef.current?.getDrawingCoordinates(id);
        if (!textCoordinate || id.startsWith("temporary-")) return;
        if ([...lineTargetsRef.current.values()].some(target => {
          const y = series.priceToCoordinate(target.price); return y !== null && Math.abs(Number(y) - (event.clientY - rect.top)) <= 8;
        })) return;
        stopEvent(event); onSelectedDrawingIdChangeRef.current(id); selectedDrawingIdRef.current = id;
        hoverText(id);
        textClicks.current!.clear();
        textDragging = { id, clientX: event.clientX, clientY: event.clientY, timeStamp: event.timeStamp, geometry: drawing.geometry, x: textCoordinate.x, y: textCoordinate.y, moved: false };
        capturedPointer = event.pointerId; interaction.setPointerCapture(event.pointerId); chart.applyOptions({ handleScroll: false }); setChartCursor("pointer"); return;
      }
      const coordinate = drawing ? drawingCoordinates(drawing) : null;
      if (!drawing || !coordinate || id.startsWith("temporary-")) return;
      stopEvent(event);
      onSelectedDrawingIdChangeRef.current(id);
      selectedDrawingIdRef.current = id;
      dragging = {
        id,
        kind: hit.part as "start" | "end" | "line" | RectangleHandle,
        clientX: event.clientX,
        clientY: event.clientY,
        geometry: drawing.geometry,
        start: coordinate.start,
        end: coordinate.end,
      };
      interaction.setPointerCapture(event.pointerId);
      capturedPointer = event.pointerId;
      chart.applyOptions({ handleScroll: false });
      setChartCursor(dragging.kind === "line" ? "move" : "crosshair");
    };

    const processDrawingMove = (event: PointerEvent) => {
      if (abcdDragging) {
        stopEvent(event);
        const dx = event.clientX - abcdDragging.clientX, dy = event.clientY - abcdDragging.clientY;
        if (Math.hypot(dx, dy) < 3 && !abcdPreviewRef.current) return;
        const geometry = moveAbcdGeometry(abcdDragging.geometry, abcdDragging.coordinates, abcdDragging.part, dx, dy,
          point => pointAtCoordinate(point.x, point.y, false));
        if (geometry) { abcdPreviewRef.current = { id: abcdDragging.id, geometry }; syncDrawingPrimitive(); }
        return;
      }
      if (drawingToolRef.current === "AB_CD" && abcdDraftRef.current) {
        const point = pointAt(event.clientX, event.clientY);
        if (point) { stopEvent(event); abcdDraftRef.current = previewAbcdDraft(abcdDraftRef.current, point.anchor); syncDrawingPrimitive(); }
        return;
      }
      if (arrowDragging) {
        stopEvent(event);
        const dx = event.clientX - arrowDragging.clientX, dy = event.clientY - arrowDragging.clientY;
        if (!arrowDragging.moved && Math.hypot(dx, dy) < 3) return;
        arrowDragging.moved = true;
        const positioned = pointAtCoordinate(arrowDragging.x + dx, arrowDragging.y + dy, false);
        if (positioned) {
          const original = arrowDragging.geometry.anchor;
          const anchor = { ...positioned.anchor };
          if (dx === 0 || positioned.coordinate.x === arrowDragging.x) { anchor.timestamp = original.timestamp; anchor.sourceSequence = original.sourceSequence; }
          if (dy === 0 || positioned.coordinate.y === arrowDragging.y) anchor.price = original.price;
          arrowDragRef.current = { id: arrowDragging.id, geometry: { anchor } }; syncDrawingPrimitive();
        }
        return;
      }
      if (textDragging) {
        stopEvent(event);
        const dx = event.clientX - textDragging.clientX, dy = event.clientY - textDragging.clientY;
        if (!textDragging.moved) {
          if (!textPointerMoved(textDragging, event)) return;
          textDragging.moved = true; setChartCursor("pointer");
        }
        const positioned = pointAtCoordinate(textDragging.x + dx, textDragging.y + dy, false);
        if (positioned) {
          const original = textDragging.geometry.anchor;
          const anchor = { ...positioned.anchor };
          if (dx === 0 || positioned.coordinate.x === textDragging.x) { anchor.timestamp = original.timestamp; anchor.sourceSequence = original.sourceSequence; }
          if (dy === 0 || positioned.coordinate.y === textDragging.y) anchor.price = original.price;
          textDragRef.current = { id: textDragging.id, geometry: { anchor, text: textDragging.geometry.text } }; syncDrawingPrimitive();
        }
        return;
      }
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
      if (!dragging) {
        const target = event.target as HTMLElement;
        if (drawingToolRef.current || measurementArmedRef.current || event.shiftKey || textEditRef.current?.inline || !interaction.contains(target)
          || target.closest("button,input,textarea,[data-text-editor],[data-context-menu],[data-order-ticket],[data-line-action]")) { hoverText(null); return; }
        const rect = container.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const textHit = textPrimitiveRef.current?.hitTestAt(point);
        const hit = textHit ? hitDrawingAt(point) : null;
        const nearOrder = textHit && [...lineTargetsRef.current.values()].some(target => {
          const y = series.priceToCoordinate(target.price); return y !== null && Math.abs(Number(y) - point.y) <= 8;
        });
        hoverText(hit?.drawingId === textHit?.drawingId && !nearOrder ? textHit?.drawingId ?? null : null); return;
      }
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
      const active = dragging || textDragging || arrowDragging || abcdDragging || drawingToolRef.current && (drawingDraftRef.current || abcdDraftRef.current);
      if (!active && !drawingGroupsRef.current.text.length) return;
      if (!active && (textEditRef.current?.inline || !interaction.contains(event.target as Node))) { hoverText(null); return; }
      if (active) stopEvent(event);
      pendingPointer = event;
      if (pointerFrame !== null) return;
      pointerFrame = requestAnimationFrame(() => {
        const pointer = pendingPointer;
        clearPointerFrame();
        if (pointer) processDrawingMove(pointer);
      });
    };
    const finish = (event: PointerEvent) => {
      if (abcdDragging) {
        const moved = pendingPointer !== null || event.clientX !== abcdDragging.clientX || event.clientY !== abcdDragging.clientY;
        clearPointerFrame(); if (moved) processDrawingMove(event); stopEvent(event);
        const preview = abcdPreviewRef.current;
        if (preview && JSON.stringify(preview.geometry) !== JSON.stringify(abcdDragging.geometry)) onUpdateDrawingRef.current(preview.id, preview.geometry);
        abcdDragging = null;
        abcdReleaseFrame = requestAnimationFrame(() => { abcdReleaseFrame = null; abcdPreviewRef.current = null; syncDrawingPrimitive(); });
        if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
        capturedPointer = null; chart.applyOptions({ handleScroll: true }); setChartCursor(""); return;
      }
      if (arrowDragging) {
        const moved = pendingPointer !== null || event.clientX !== arrowDragging.clientX || event.clientY !== arrowDragging.clientY;
        clearPointerFrame(); if (moved) processDrawingMove(event); stopEvent(event);
        const preview = arrowDragRef.current;
        if (preview && JSON.stringify(preview.geometry) !== JSON.stringify(arrowDragging.geometry)) onUpdateDrawingRef.current(preview.id, preview.geometry);
        arrowDragging = null;
        requestAnimationFrame(() => { arrowDragRef.current = null; syncDrawingPrimitive(); });
        if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
        capturedPointer = null; chart.applyOptions({ handleScroll: true }); setChartCursor(""); return;
      }
      if (textDragging) {
        const moved = pendingPointer !== null || event.clientX !== textDragging.clientX || event.clientY !== textDragging.clientY;
        clearPointerFrame(); if (moved) processDrawingMove(event); stopEvent(event);
        const preview = textDragRef.current;
        if (preview && JSON.stringify(preview.geometry) !== JSON.stringify(textDragging.geometry)) onUpdateDrawingRef.current(preview.id, preview.geometry);
        const clickedId = textDragging.moved ? null : textDragging.id;
        textDragging = null; textDragRef.current = null; syncDrawingPrimitive();
        if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
        capturedPointer = null;
        chart.applyOptions({ handleScroll: true }); setChartCursor("");
        if (clickedId) { textClicks.current!.released(clickedId, event); onOpenDrawingStyleRef.current(clickedId, true); }
        return;
      }
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
      textDragging = null; textDragRef.current = null;
      arrowDragging = null; arrowDragRef.current = null;
      requestAnimationFrame(() => commitPreview(null));
      if (interaction.hasPointerCapture(event.pointerId)) interaction.releasePointerCapture(event.pointerId);
      capturedPointer = null;
      chart.applyOptions({ handleScroll: true });
      setChartCursor("");
    };
    const cancelDrag = () => {
      textClicks.current!.clear(); hoverText(null);
      clearPointerFrame();
      dragging = null;
      textDragging = null; textDragRef.current = null;
      arrowDragging = null; arrowDragRef.current = null;
      abcdDragging = null; abcdPreviewRef.current = null;
      if (abcdReleaseFrame !== null) { cancelAnimationFrame(abcdReleaseFrame); abcdReleaseFrame = null; }
      commitPreview(null);
      if (capturedPointer !== null && interaction.hasPointerCapture(capturedPointer)) interaction.releasePointerCapture(capturedPointer);
      capturedPointer = null;
      chart.applyOptions({ handleScroll: true });
      setChartCursor(drawingToolRef.current ? "crosshair" : "");
    };
    const leave = () => { if (!dragging && !textDragging && !arrowDragging && !abcdDragging) hoverText(null); };
    const doubleClick = (event: MouseEvent) => {
      textClicks.current!.clear();
      if ((event.target as HTMLElement).closest("[data-text-editor]")) return;
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
      if (event.defaultPrevented || event.isComposing || hasVisibleReplayDialog() || isReplayShortcutInputTarget(event.target)) return;
      if (event.key === "Escape" && (dragging || textDragging || arrowDragging || abcdDragging)) {
        stopEvent(event);
        cancelDrag();
        return;
      }
      if (event.key === "Escape" && (drawingToolRef.current || drawingDraftRef.current || abcdDraftRef.current)) {
        stopEvent(event);
        commitDraft(null, null);
        abcdDraftRef.current = null;
        syncDrawingPrimitive();
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
    interaction.addEventListener("pointerleave", leave);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    window.addEventListener("blur", cancelDrag);
    interaction.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key, true);
    return () => {
      // Cleanup uses the latest bridge and chart after drawing or scope changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      textClicks.current!.clear(); hoverText(null);
      clearPointerFrame();
      textDragRef.current = null;
      arrowDragRef.current = null;
      abcdDraftRef.current = null; abcdPreviewRef.current = null;
      if (abcdReleaseFrame !== null) cancelAnimationFrame(abcdReleaseFrame);
      if (capturedPointer !== null && interaction.hasPointerCapture(capturedPointer)) interaction.releasePointerCapture(capturedPointer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (chartRef.current === chart) { chart.applyOptions({ handleScroll: true }); commitPreview(null); }
      interaction.removeEventListener("pointerdown", down, true);
      interaction.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
      window.removeEventListener("blur", cancelDrag);
      interaction.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [abcdPrimitiveRef, abcdDraftRef, abcdPreviewRef, onCreateAbcdRef, arrowPrimitiveRef, arrowDragRef, onPlaceArrowRef, priceTickSize, setChartCursor, syncDrawingPrimitive, visibilityScope, barsRef, candleRef, chartRef, containerRef, displayIntervalSecondsRef, drawingDraftCoordinateRef, drawingDraftRef, drawingGroupsRef, drawingPreviewRef, drawingSessionRef, drawingTimelineRef, drawingToolRef, drawingsRef, fibonacciPrimitiveRef, interactionRef, lineTargetsRef, measurementArmedRef, onCreateDrawingRef, onDeleteDrawingRef, onDrawingToolChangeRef, onOpenDrawingStyleRef, onPlaceTextRef, onSelectedDrawingIdChangeRef, onUpdateDrawingRef, rectanglePrimitiveRef, selectedDrawingIdRef, setContextMenu, sourceIntervalSecondsRef, textClicks, textDragRef, textEditRef, textPrimitiveRef, trendLinePrimitiveRef]);

}
