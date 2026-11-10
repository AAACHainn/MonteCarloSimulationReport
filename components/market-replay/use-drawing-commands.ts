"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction, type RefObject } from "react";
import { copy } from "@/lib/i18n";
import { createUuid } from "@/lib/uuid";
import type { MarketDrawing } from "@/lib/market-replay/chart-drawings";
import { cloneDrawingValue, DrawingHistory, type DrawingHistoryEntry } from "@/lib/market-replay/drawing-history";
import { runDrawingWrite } from "@/lib/market-replay/drawing-write-queue";
import { hasVisibleReplayDialog, isDrawingNudgeTarget, isReplayShortcutInputTarget, replayDrawingEditShortcut, replayDrawingNudgeKey, replayDrawingShortcutKey } from "@/lib/market-replay/keyboard-shortcuts";
import { isDrawingShortcutRecording } from "./drawing-shortcut-recorder";
import { useDrawingHistory } from "./replay-session-context";
import { useReplayShortcuts } from "./use-replay-shortcuts";
import { useDrawingNudge } from "./use-drawing-nudge";
import type { TextDrawingApi } from "@/lib/market-replay/text-drawing-primitive";

function entryLabel(entry: DrawingHistoryEntry | null) {
  if (!entry) return null;
  const t = copy.marketReplay.drawingEditing;
  if (entry.action === "clear") return t.clearCount(entry.changes.length);
  const drawing = entry.changes[0]?.after ?? entry.changes[0]?.before;
  const names = { TREND_LINE: copy.marketReplay.trendLine, RECTANGLE: copy.marketReplay.rectangle, TEXT: copy.marketReplay.textTool,
    FIB_RETRACEMENT: copy.marketReplay.fibonacciRetracement, AB_CD: copy.marketReplay.abcd, ARROW_UP: copy.marketReplay.arrowUp, ARROW_DOWN: copy.marketReplay.arrowDown };
  return drawing ? t.operation(t[entry.action], names[drawing.type]) : t[entry.action];
}

export function useDrawingCommands(options: {
  datasetId: string; scope: string; fetch: typeof fetch; drawings: MarketDrawing[]; selectedDrawingId: string | null;
  setDrawings: Dispatch<SetStateAction<MarketDrawing[]>>; select: (id: string | null) => void; disabled: boolean;
  editor: { key: string; id: string | null; inline?: boolean } | null;
  chartApi: RefObject<TextDrawingApi | null>;
  displayKey?: string;
  onNudgeError?: (error: string | null) => void;
}) {
  const provided = useDrawingHistory();
  const fallback = useMemo(() => new DrawingHistory(), []);
  const history = provided ?? fallback;
  const view = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const { platform } = useReplayShortcuts();
  const [pending, setPending] = useState(false);
  const { busy: nudging, previews: nudgePreviews, isBusy: isNudging, finish: finishNudge, press: nudge, flush: flushNudges } = useDrawingNudge({ ...options, history });
  const clipboard = useRef<MarketDrawing | null>(null);
  const submitting = useRef(false);
  const frozenPaste = useRef<{ drawing: MarketDrawing; clientId: string } | null>(null);
  const epoch = useRef(0);
  const latest = useRef({ ...options, platform }); latest.current = { ...options, platform };
  useLayoutEffect(() => {
    const lifetime = epoch;
    lifetime.current++; history.reset(); clipboard.current = null; frozenPaste.current = null; setPending(false);
    return () => { lifetime.current++; history.reset(); };
  }, [options.scope, history]);
  useLayoutEffect(() => { finishNudge(); }, [options.displayKey, options.selectedDrawingId, options.disabled, options.editor, finishNudge]);
  const textGroup = useCallback((key: string | null, id: string | null = null) => history.setTextGroup(key, id), [history]);
  useEffect(() => {
    if (!pending && !nudging && !frozenPaste.current) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [pending, nudging]);
  const merge = useCallback((drawings: MarketDrawing[], deletedIds: string[]) => {
    const ids = new Set([...deletedIds, ...drawings.map(drawing => drawing.id)]);
    latest.current.setDrawings(current => [...current.filter(drawing => !ids.has(drawing.id)), ...drawings]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
    if (latest.current.selectedDrawingId && deletedIds.includes(latest.current.selectedDrawingId)) latest.current.select(null);
  }, []);
  const travel = useCallback(async (direction: "undo" | "redo") => {
    const current = latest.current;
    if (current.disabled || current.editor || frozenPaste.current || submitting.current || isNudging() || history.getSnapshot().busy) return;
    const generation = epoch.current;
    submitting.current = true; setPending(true);
    try {
      await runDrawingWrite(current.scope, async () => {
        if (generation !== epoch.current) return;
        const result = await history.travel(direction, current.fetch, current.datasetId);
        if (generation === epoch.current) merge(result.drawings, result.deletedIds);
      });
    } catch (error) {
      if (generation !== epoch.current) return;
      const conflict = error instanceof Error && error.message === "DRAWING_HISTORY_CONFLICT";
      if (conflict) {
        const response = await current.fetch(`/api/market-datasets/${current.datasetId}/drawings`).catch(() => null);
        const data = response?.ok ? await response.json().catch(() => null) : null;
        if (generation === epoch.current && Array.isArray(data?.drawings)) current.setDrawings(data.drawings);
      }
    } finally { submitting.current = false; if (generation === epoch.current) setPending(false); }
  }, [history, isNudging, merge]);
  const placePaste = useCallback(async (drawing: MarketDrawing) => {
    const current = latest.current;
    if (submitting.current || isNudging() || current.disabled) return;
    const generation = epoch.current;
    // Freeze the first request and its UUID until the result is known. A retry
    // must not make another object or move a creation that already succeeded.
    frozenPaste.current ??= { drawing: cloneDrawingValue(drawing), clientId: createUuid() };
    const request = frozenPaste.current;
    submitting.current = true; setPending(true);
    try {
      await runDrawingWrite(current.scope, async () => {
        if (generation !== epoch.current) return;
        const response = await current.fetch(`/api/market-datasets/${current.datasetId}/drawings`, { method: "POST",
          headers: { "Content-Type": "application/json", "X-Drawing-Action": "paste" },
          body: JSON.stringify({ type: request.drawing.type, geometry: request.drawing.geometry, style: request.drawing.style, clientId: request.clientId }) });
        if (generation !== epoch.current) return;
        if (!response.ok) {
          if (response.status === 409) throw new Error("DRAWING_HISTORY_CONFLICT");
          // Validation/permission/not-found responses explicitly reject creation.
          // Parse status before JSON: an HTML error body must not freeze editing.
          if (response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)) {
            frozenPaste.current = null; return;
          }
          throw new Error("DRAWING_PASTE_FAILED");
        }
        const data = await response.json() as { drawing?: MarketDrawing };
        if (!data.drawing) throw new Error("DRAWING_PASTE_FAILED");
        if (generation !== epoch.current) return;
        merge([data.drawing], []); current.select(data.drawing.id);
        frozenPaste.current = null;
      });
    } catch (error) {
      if (generation !== epoch.current) return;
      const conflict = error instanceof Error && error.message === "DRAWING_HISTORY_CONFLICT";
      if (conflict) {
        history.clear(); frozenPaste.current = null;
        const response = await current.fetch(`/api/market-datasets/${current.datasetId}/drawings`).catch(() => null);
        const data = response?.ok ? await response.json().catch(() => null) : null;
        if (generation === epoch.current && Array.isArray(data?.drawings)) current.setDrawings(data.drawings);
      }
    }
    finally { submitting.current = false; if (generation === epoch.current) setPending(false); }
  }, [merge, history, isNudging]);
  useLayoutEffect(() => {
    let pointerHeld = false;
    const down = () => { pointerHeld = true; finishNudge(); };
    const up = () => { pointerHeld = false; };
    const blur = () => { up(); finishNudge(); };
    const release = (event: KeyboardEvent) => finishNudge(event.key);
    const focusOut = () => finishNudge();
    const visibility = () => { if (document.visibilityState === "hidden") blur(); };
    const key = (event: KeyboardEvent) => {
      const current = latest.current;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || isDrawingShortcutRecording()
        || document.visibilityState === "hidden" || isReplayShortcutInputTarget(event.target) || hasVisibleReplayDialog()
        || document.querySelector("[data-context-menu], [role='menu'], [role='listbox'], [data-drawing-template-picker]")) return;
      if ((frozenPaste.current || isNudging()) && replayDrawingShortcutKey(event)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (current.disabled || current.editor || pointerHeld || submitting.current) return;
      const direction = replayDrawingNudgeKey(event);
      const id = current.selectedDrawingId;
      if (direction && id && !id.startsWith("temporary-") && !frozenPaste.current && current.chartApi.current?.nudgeDrawing && isDrawingNudgeTarget(event.target, id)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        nudge(direction, event.repeat, id);
        return;
      }
      if (event.repeat || isNudging()) return;
      const action = replayDrawingEditShortcut(event, current.platform);
      if (!action) return;
      if (action === "copy") {
        const drawing = current.drawings.find(item => item.id === current.selectedDrawingId && !item.id.startsWith("temporary-"));
        if (!drawing || frozenPaste.current) return;
        clipboard.current = cloneDrawingValue(drawing);
      } else if (action === "paste") {
        if (!clipboard.current) return;
        const positioned = current.chartApi.current?.positionCopy?.(clipboard.current);
        if (!positioned) return;
        void placePaste(positioned);
      } else {
        if (frozenPaste.current || !history.getSnapshot()[action]) return;
        void travel(action);
      }
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", key, true); window.addEventListener("pointerdown", down, true); window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true); window.addEventListener("blur", blur);
    window.addEventListener("keyup", release, true);
    window.addEventListener("focusout", focusOut, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true); window.removeEventListener("blur", blur);
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("focusout", focusOut, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [finishNudge, history, isNudging, nudge, placePaste, travel]);
  return { pasteUnconfirmed: Boolean(frozenPaste.current), pending: pending || nudging, textGroup, nudging, nudgePreviews, flushNudges,
    undo: () => void travel("undo"), redo: () => void travel("redo"), undoLabel: entryLabel(view.undo), redoLabel: entryLabel(view.redo),
    historyDisabled: options.disabled || Boolean(options.editor) || Boolean(frozenPaste.current) || pending || nudging || view.busy,
    undoShortcut: platform === "mac" ? "⌘+Z" : "Ctrl+Z", redoShortcut: platform === "mac" ? "⌘+Shift+Z" : "Ctrl+Y",
    undoAria: platform === "mac" ? "Meta+Z" : "Control+Z", redoAria: platform === "mac" ? "Meta+Shift+Z" : "Control+Y" };
}
