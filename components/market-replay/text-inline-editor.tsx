"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/i18n";
import { TEXT_FONT_FAMILY, TEXT_PADDING } from "@/lib/market-replay/text-layout";
import type { DrawingAnchor, TextDrawingStyle } from "@/lib/market-replay/chart-drawings";
import type { TextDrawingApi, TextEditorPosition } from "@/lib/market-replay/text-drawing-primitive";
import { listenForTextEditorOutside } from "./text-inline-editor-events";

export function TextInlineEditor({ apiRef, anchor, text, style, onChange, valid, saving, disabled, error, onFinish, onSettings, onRetry,
  onSuspend, onWidth, onRestoreStyle, onResizeEnd }: {
  apiRef: RefObject<TextDrawingApi | null>; anchor: DrawingAnchor; text: string; style: TextDrawingStyle;
  onChange: (text: string) => void; valid: boolean; saving: boolean; disabled: boolean; error: string | null;
  onFinish: () => Promise<boolean>; onSettings: () => Promise<boolean>; onRetry: () => Promise<void>;
  onSuspend: (reason: string, suspended: boolean) => void; onWidth: (width: number) => void;
  onRestoreStyle: (style: TextDrawingStyle) => void; onResizeEnd: () => Promise<void>;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<TextEditorPosition | null>(null);
  const [height, setHeight] = useState(38);
  const [naturalWidth, setNaturalWidth] = useState(132);
  const resize = useRef<{ pointer: number; x: number; width: number; style: TextDrawingStyle; latestX: number } | null>(null);
  const handle = useRef<HTMLButtonElement>(null), frame = useRef<number | null>(null), composing = useRef(false);
  const latest = useRef({ onFinish, onWidth }); latest.current = { onFinish, onWidth };
  const initialText = useRef(text);
  useLayoutEffect(() => apiRef.current?.subscribePosition(anchor, next => setPosition(old =>
    old?.host === next?.host && old?.x === next?.x && old?.y === next?.y && old?.width === next?.width && old?.height === next?.height ? old : next)), [apiRef, anchor]);
  const host = position?.host;
  useEffect(() => {
    if (!host) return;
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus(); input.current?.setSelectionRange(initialText.current.length, initialText.current.length);
    const panel = root.current;
    const cleanup = panel ? listenForTextEditorOutside(panel, () => { if (!composing.current && !resize.current) void latest.current.onFinish(); }) : undefined;
    return () => {
      cleanup?.();
      if (panel?.contains(document.activeElement) && previous?.isConnected) previous.focus();
    };
  }, [host]);
  useEffect(() => { if (error) input.current?.focus(); }, [error]);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const pointer = resize.current?.pointer;
    const node = handle.current;
    if (pointer !== undefined && node?.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
    resize.current = null;
  }, []);
  const width = style.wrapEnabled ? style.wrapWidth + TEXT_PADDING * 2 : naturalWidth;
  const maxHeight = Math.max(38, (position?.height ?? 300) - 32);
  useLayoutEffect(() => {
    const node = input.current; if (!node) return;
    if (!style.wrapEnabled) {
      // Native text layout gives the actual unwrapped width; no per-character estimate or extra canvas measurement.
      const previousWidth = node.style.width; node.style.width = "0px";
      const measuredWidth = node.scrollWidth; node.style.width = previousWidth;
      setNaturalWidth(Math.max(text ? TEXT_PADDING * 2 + 1 : 132, Math.min(812, measuredWidth)));
    }
    node.style.height = "0px";
    const next = Math.min(maxHeight, Math.max(Math.ceil(style.fontSize * 1.4) + TEXT_PADDING * 2, node.scrollHeight));
    node.style.height = `${next}px`; setHeight(next);
  }, [text, style.fontSize, style.bold, style.italic, style.wrapEnabled, style.wrapWidth, maxHeight, host]);
  const applyResize = (x: number) => {
    const drag = resize.current;
    if (drag) latest.current.onWidth(Math.max(120, Math.min(800, Math.round(drag.width + x - drag.x))));
  };
  if (!position) return null;
  const left = Math.max(8, Math.min(position.x, position.width - width - 16));
  const top = Math.max(8, Math.min(position.y, position.height - height - 10));
  const background = style.backgroundEnabled ? `${style.backgroundColor}${Math.round(style.backgroundOpacity / 100 * 255).toString(16).padStart(2, "0")}` : "transparent";
  return createPortal(<div ref={root} data-text-editor role="dialog" aria-modal="false" aria-labelledby={`${id}-label`}
    className="absolute z-40 select-text" style={{ left, top, maxWidth: Math.max(120, position.width - 16) }}
    onPointerDown={event => {
      event.stopPropagation();
      if (event.button === 0 && (event.target as HTMLElement).closest("textarea") && !composing.current
        && apiRef.current?.consumeDoubleClick?.(event.nativeEvent)) { event.preventDefault(); void onSettings(); }
    }} onDoubleClick={event => {
      event.stopPropagation();
      if (!(event.target as HTMLElement).closest("textarea") || composing.current || resize.current) return;
      event.preventDefault(); void onSettings();
    }}
    onContextMenu={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || composing.current) return;
      if (event.key === "Escape" || event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void onFinish(); }
      if (event.key === "Enter" && event.altKey) { event.preventDefault(); void onSettings(); }
    }}>
    <Label id={`${id}-label`} htmlFor={`${id}-input`} className="sr-only">{copy.marketReplay.textInlineEdit}</Label>
    <p id={`${id}-hint`} className="sr-only">{copy.marketReplay.textInlineHint}</p>
    <div className={width > position.width - 16 ? "-m-1 overflow-x-auto overflow-y-hidden p-1" : "-m-1 p-1"}>
      <div className="relative outline outline-1 outline-blue-600" style={{ width, backgroundColor: background }}>
        <Textarea ref={input} id={`${id}-input`} value={text} autoFocus rows={1} disabled={disabled}
          placeholder={copy.marketReplay.textInlinePlaceholder} wrap={style.wrapEnabled ? "soft" : "off"}
          aria-invalid={Boolean(text) && !valid} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          className="block min-h-0 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          style={{ padding: TEXT_PADDING, color: style.color, fontFamily: TEXT_FONT_FAMILY, fontSize: style.fontSize,
            fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? "italic" : "normal", lineHeight: `${Math.ceil(style.fontSize * 1.4)}px`, tabSize: 4 }}
          onCompositionStart={() => { composing.current = true; onSuspend("composition", true); }}
          onCompositionEnd={event => { composing.current = false; onChange(event.currentTarget.value); onSuspend("composition", false); }}
          onChange={event => onChange(event.target.value)} />
        <button ref={handle} type="button" role="separator" aria-orientation="vertical" disabled={disabled}
          aria-label={copy.marketReplay.textResizeWidth} aria-valuemin={120} aria-valuemax={800} aria-valuenow={style.wrapWidth}
          className="absolute -right-5 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation(); onSuspend("resize", true);
            resize.current = { pointer: event.pointerId, x: event.clientX, width: width - TEXT_PADDING * 2, style: { ...style }, latestX: event.clientX };
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={event => {
            const drag = resize.current; if (!drag || drag.pointer !== event.pointerId) return;
            drag.latestX = event.clientX;
            if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (resize.current) applyResize(resize.current.latestX); });
          }} onPointerUp={event => {
            if (resize.current?.pointer !== event.pointerId) return;
            if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
            applyResize(event.clientX); resize.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            onSuspend("resize", false); void onResizeEnd();
          }} onPointerCancel={event => {
            const drag = resize.current; if (!drag) return;
            if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
            resize.current = null; onRestoreStyle(drag.style); onSuspend("resize", false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }} onKeyDown={event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault(); event.stopPropagation();
            onWidth(Math.max(120, Math.min(800, style.wrapWidth + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1))));
          }}><span aria-hidden="true" className="h-2 w-2 rounded-sm border border-blue-600 bg-white" /></button>
      </div>
    </div>
    <div aria-live="polite" className="absolute left-0 top-full mt-1 max-w-full text-xs">
      {error || text.trim() && !valid ? <div id={`${id}-error`} role="alert" className="rounded border border-red-200 bg-white p-2 text-red-700">
        {error || copy.marketReplay.textContentError}
        {error ? <Button type="button" variant="ghost" size="sm" onClick={() => void onRetry()}>{copy.marketReplay.textSaveRetry}</Button> : null}
      </div> : saving ? <span className="sr-only">{copy.marketReplay.textAutosaving}</span>
        : <span className="sr-only">{copy.marketReplay.textAutosaved}</span>}
    </div>
  </div>, position.host);
}
