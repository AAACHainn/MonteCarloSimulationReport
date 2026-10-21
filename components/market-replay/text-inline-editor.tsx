"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/i18n";
import { TEXT_FONT_FAMILY, TEXT_PADDING } from "@/lib/market-replay/text-layout";
import type { DrawingAnchor, TextDrawingStyle } from "@/lib/market-replay/chart-drawings";
import type { TextDrawingApi, TextEditorPosition } from "@/lib/market-replay/text-drawing-primitive";
import { listenForTextEditorOutside } from "./text-inline-editor-events";

/** Only the actively edited object gets DOM controls. No per-object overlays or listeners. */
export function TextInlineEditor({ apiRef, anchor, text, style, onChange, valid, busy, error, onSave, onClose, onSettings }: {
  apiRef: RefObject<TextDrawingApi | null>; anchor: DrawingAnchor; text: string; style: TextDrawingStyle;
  onChange: (text: string) => void; valid: boolean; busy: boolean; error: string | null;
  onSave: () => Promise<void>; onClose: () => void; onSettings: () => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<TextEditorPosition | null>(null);
  const [panelHeight, setPanelHeight] = useState(180);
  const latest = useRef({ busy, text, onSave, onClose }); latest.current = { busy, text, onSave, onClose };
  const initialText = useRef(text);
  useLayoutEffect(() => apiRef.current?.subscribePosition(anchor, next => setPosition(old =>
    old?.host === next?.host && old?.x === next?.x && old?.y === next?.y && old?.width === next?.width && old?.height === next?.height ? old : next)), [apiRef, anchor]);
  const host = position?.host;
  useLayoutEffect(() => {
    const panel = root.current; if (!panel) return;
    const observer = new ResizeObserver(() => setPanelHeight(Math.ceil(panel.getBoundingClientRect().height)));
    observer.observe(panel); return () => observer.disconnect();
  }, [host]);
  useEffect(() => {
    if (!host) return;
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus(); input.current?.setSelectionRange(initialText.current.length, initialText.current.length);
    const panel = root.current;
    const cleanup = panel ? listenForTextEditorOutside(panel, () => {
      const current = latest.current;
      if (current.busy) return;
      if (!current.text.trim()) current.onClose();
      else void current.onSave();
    }) : undefined;
    return () => {
      cleanup?.();
      if (panel?.contains(document.activeElement) && previous?.isConnected) previous.focus();
    };
  }, [host]);
  useEffect(() => { if (error && !busy) input.current?.focus(); }, [error, busy]);
  const maxHeight = Math.max(56, Math.min(240, (position?.height ?? 300) - 128));
  const width = Math.max(120, Math.min(style.wrapEnabled ? style.wrapWidth + TEXT_PADDING * 2 : 280, (position?.width ?? 300) - 16));
  useLayoutEffect(() => {
    const node = input.current; if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(maxHeight, Math.max(56, node.scrollHeight))}px`;
  }, [text, style.fontSize, style.bold, style.italic, style.wrapEnabled, width, maxHeight, host]);
  if (!position) return null;
  const left = Math.max(8, Math.min(position.x, position.width - width - 8));
  const top = Math.max(8, Math.min(position.y, position.height - panelHeight - 8));
  return createPortal(<div ref={root} data-text-editor role="dialog" aria-modal="false" aria-labelledby={`${id}-label`}
    aria-busy={busy} className="absolute z-40 select-text rounded-md border border-blue-600 bg-white shadow-lg"
    style={{ left, top, width, maxHeight: Math.max(120, position.height - 16), overflowY: "auto" }} onPointerDown={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); if (!busy) onClose(); }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void onSave(); }
    }}>
    <Label id={`${id}-label`} htmlFor={`${id}-input`} className="sr-only">{copy.marketReplay.textInlineEdit}</Label>
    <Textarea ref={input} id={`${id}-input`} value={text} disabled={busy} autoFocus rows={2}
      placeholder={copy.marketReplay.textInlinePlaceholder} wrap={style.wrapEnabled ? "soft" : "off"}
      aria-invalid={Boolean(text) && !valid} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
      className="min-h-14 resize-none rounded-b-none border-0 shadow-none focus-visible:ring-inset"
      style={{ padding: TEXT_PADDING, color: style.color, fontFamily: TEXT_FONT_FAMILY, fontSize: style.fontSize,
        fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? "italic" : "normal", lineHeight: `${Math.ceil(style.fontSize * 1.4)}px`, tabSize: 4 }}
      onChange={event => onChange(event.target.value)} />
    <div className="space-y-2 border-t p-2">
      <p id={`${id}-hint`} className={text && !valid ? "text-xs text-red-600" : "text-xs text-slate-500"}>
        {text && !valid ? copy.marketReplay.textContentError : copy.marketReplay.textInlineHint}
      </p>
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-red-600">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="icon" className="mr-auto" disabled={busy}
          aria-label={copy.marketReplay.textSettings} onClick={onSettings}><Settings2 className="h-4 w-4" aria-hidden="true" /></Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
        <Button type="button" disabled={busy || !valid} onClick={() => void onSave()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.marketReplay.drawingConfirm}
        </Button>
      </div>
    </div>
  </div>, position.host);
}
