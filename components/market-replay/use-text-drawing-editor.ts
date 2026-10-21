"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingAnchor, MarketDrawing, TextDrawingStyle } from "@/lib/market-replay/chart-drawings";
import type { TextDrawingApi, TextEditPreview } from "@/lib/market-replay/text-drawing-primitive";
import { createUuid } from "@/lib/uuid";
import type { TextEditor } from "./text-settings-dialog";
export type TextEditorControl = { finish: () => Promise<boolean>; settings: () => Promise<boolean>; discard: () => Promise<void> };

export function useTextDrawingEditor(scope: string, visible: boolean, drawings: MarketDrawing[], defaultStyle: TextDrawingStyle) {
  const [editor, setEditor] = useState<TextEditor | null>(null);
  const editorRef = useRef(editor); editorRef.current = editor;
  const controlRef = useRef<TextEditorControl | null>(null);
  const epoch = useRef(0);
  const apiRef = useRef<TextDrawingApi | null>(null);
  const scopeRef = useRef(scope);
  if (scopeRef.current !== scope) { scopeRef.current = scope; epoch.current++; }
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const preview = useCallback((next: TextEditPreview | null, owner: string) => {
    if (editorRef.current?.key === owner) apiRef.current?.previewText(next);
  }, []);
  const close = useCallback(() => { epoch.current++; editorRef.current = null; controlRef.current = null; setEditor(null); apiRef.current?.previewText(null); }, []);
  useEffect(() => { close(); }, [scope, visible, close]);
  useEffect(() => { if (editor?.id && !drawings.some(item => item.id === editor.id)) close(); }, [drawings, editor, close]);
  const place = useCallback((anchor: DrawingAnchor) => {
    epoch.current++; const next = { key: createUuid(), id: null, inline: true, geometry: { anchor, text: "" }, style: { ...defaultStyle } };
    editorRef.current = next; setEditor(next);
  }, [defaultStyle]);
  const open = useCallback((drawing: MarketDrawing, inline = false) => {
    if (drawing.type !== "TEXT") return false;
    epoch.current++; const next = { key: createUuid(), id: drawing.id, inline, geometry: { ...drawing.geometry }, style: { ...drawing.style } };
    editorRef.current = next; setEditor(next);
    return true;
  }, []);
  const guard = useCallback(() => { const current = scopeRef.current, generation = epoch.current; return () => alive.current && scopeRef.current === current && epoch.current === generation; }, []);
  const adopt = useCallback((id: string, owner: string) => {
    if (editorRef.current?.key !== owner) return;
    const next = { ...editorRef.current, id }; editorRef.current = next; setEditor(next);
  }, []);
  const register = useCallback((control: TextEditorControl | null, owner: string) => {
    if (editorRef.current?.key === owner) controlRef.current = control;
  }, []);
  const beforeExit = useCallback(async () => controlRef.current ? controlRef.current.finish() : true, []);
  const requestSettings = useCallback(async (id: string) => {
    if (editorRef.current?.id !== id || !controlRef.current) return false;
    await controlRef.current.settings(); return true;
  }, []);
  const discard = useCallback(async (id?: string) => {
    if (!editorRef.current || id && editorRef.current.id !== id) return;
    await controlRef.current?.discard(); close();
  }, [close]);
  return { editor, apiRef, preview, close, place, open, guard, adopt, register, beforeExit, requestSettings, discard };
}
