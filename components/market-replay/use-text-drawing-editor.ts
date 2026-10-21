"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingAnchor, MarketDrawing, TextDrawingStyle } from "@/lib/market-replay/chart-drawings";
import type { TextDrawingApi, TextEditPreview } from "@/lib/market-replay/text-drawing-primitive";
import { createUuid } from "@/lib/uuid";
import type { TextEditor } from "./text-settings-dialog";

export function useTextDrawingEditor(scope: string, visible: boolean, drawings: MarketDrawing[], defaultStyle: TextDrawingStyle) {
  const [editor, setEditor] = useState<TextEditor | null>(null);
  const apiRef = useRef<TextDrawingApi | null>(null);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const preview = useCallback((next: TextEditPreview | null) => apiRef.current?.previewText(next), []);
  const close = useCallback(() => { setEditor(null); preview(null); }, [preview]);
  useEffect(() => { close(); }, [scope, visible, close]);
  useEffect(() => { if (editor?.id && !drawings.some(item => item.id === editor.id)) close(); }, [drawings, editor, close]);
  const place = useCallback((anchor: DrawingAnchor) => setEditor({ key: createUuid(), id: null, inline: true, geometry: { anchor, text: "" }, style: { ...defaultStyle } }), [defaultStyle]);
  const open = useCallback((drawing: MarketDrawing, inline = false) => {
    if (drawing.type !== "TEXT") return false;
    setEditor({ key: createUuid(), id: drawing.id, inline, geometry: { ...drawing.geometry }, style: { ...drawing.style } });
    return true;
  }, []);
  const guard = useCallback(() => { const current = scopeRef.current; return () => alive.current && scopeRef.current === current; }, []);
  return { editor, apiRef, preview, close, place, open, guard };
}
