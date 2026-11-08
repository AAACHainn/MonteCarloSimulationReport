"use client";

import { useLayoutEffect, useRef } from "react";
import type { DrawingTool, MarketDrawing, MarketDrawingStyle } from "@/lib/market-replay/chart-drawings";
import type { DrawingAction } from "@/lib/market-replay/drawing-history";
import { drawingShortcutConflict, drawingTemplateShortcut, drawingTemplateStyle, sameDrawingTemplateShortcut, type DrawingTemplateCatalog } from "@/lib/market-replay/drawing-template-shortcuts";
import { hasVisibleReplayDialog, isReplayShortcutInputTarget, replayTrendLineWidthShortcut } from "@/lib/market-replay/keyboard-shortcuts";
import { useDrawingTemplateBindings } from "./use-drawing-template-bindings";
import { isDrawingShortcutRecording } from "./drawing-shortcut-recorder";
import { useReplayShortcuts } from "./use-replay-shortcuts";

export function useDrawingStyleShortcuts(options: {
  drawings: readonly MarketDrawing[]; selectedDrawingId: string | null; templates: DrawingTemplateCatalog;
  disabled: boolean; drawingTool: DrawingTool | null; scope: string;
  apply: (id: string, style: MarketDrawingStyle, action?: DrawingAction) => Promise<boolean>;
}) {
  const bindings = useDrawingTemplateBindings();
  const { platform } = useReplayShortcuts();
  const latest = useRef({ ...options, bindings, platform });
  latest.current = { ...options, bindings, platform };
  // Register before chart pointer effects, whose pointerup handler may stop
  // immediate propagation after ending a drawing drag.
  useLayoutEffect(() => {
    let pointerHeld = false;
    let saving = false;
    const down = () => { pointerHeld = true; };
    const up = () => { pointerHeld = false; };
    const key = (event: KeyboardEvent) => {
      const current = latest.current;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || isDrawingShortcutRecording()
        || current.disabled || current.drawingTool || pointerHeld || document.visibilityState === "hidden"
        || isReplayShortcutInputTarget(event.target) || hasVisibleReplayDialog()
        || document.querySelector("[data-context-menu], [role='menu'], [role='listbox'], [data-drawing-template-picker]")) return;
      const drawing = current.drawings.find(item => item.id === current.selectedDrawingId);
      if (!drawing || drawing.id.startsWith("temporary-")) return;
      const widthDelta = drawing.type === "TREND_LINE" ? replayTrendLineWidthShortcut(event) : null;
      let style: MarketDrawingStyle | null | undefined;
      let atWidthLimit = false;
      if (drawing.type === "TREND_LINE" && widthDelta !== null) {
        const width = Math.min(4, Math.max(1, drawing.style.width + widthDelta));
        atWidthLimit = width === drawing.style.width;
        style = { ...drawing.style, width };
      } else {
        const shortcut = drawingTemplateShortcut(event);
        if (!shortcut || drawingShortcutConflict(shortcut, current.platform)) return;
        const template = current.templates[drawing.type]?.find(item => {
          const binding = current.bindings[drawing.type]?.[item.id];
          return binding && sameDrawingTemplateShortcut(binding, shortcut);
        });
        style = template && drawingTemplateStyle(drawing.type, template.style);
      }
      if (!style) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat || saving || atWidthLimit) return;
      const nextStyle = style;
      saving = true;
      void Promise.resolve().then(() => current.apply(drawing.id, nextStyle, widthDelta === null ? "template" : "line-width")).catch(() => false).finally(() => { saving = false; });
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", down, true); window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true); window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true); window.removeEventListener("blur", up);
    };
  }, [options.scope]);
}
