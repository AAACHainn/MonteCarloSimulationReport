"use client";

import { useSyncExternalStore } from "react";
import type { DrawingType } from "@/lib/market-replay/chart-drawings";
import { parseDrawingTemplateBindings, type DrawingTemplateBindings, type DrawingTemplateShortcut } from "@/lib/market-replay/drawing-template-shortcuts";

export const DRAWING_TEMPLATE_SHORTCUTS_KEY = "market-replay-drawing-template-shortcuts-v1";
const empty: DrawingTemplateBindings = {};
let snapshot = empty;
let initialized = false;
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach(listener => listener());
function read() {
  try { snapshot = parseDrawingTemplateBindings(window.localStorage.getItem(DRAWING_TEMPLATE_SHORTCUTS_KEY)); }
  catch { snapshot = empty; }
}
function getSnapshot() {
  if (!initialized && typeof window !== "undefined") { initialized = true; read(); }
  return snapshot;
}
function storage(event: StorageEvent) {
  if (event.key === DRAWING_TEMPLATE_SHORTCUTS_KEY || event.key === null) { read(); emit(); }
}
function subscribe(listener: () => void) {
  if (!subscribers.size) { read(); window.addEventListener("storage", storage); }
  subscribers.add(listener);
  return () => { subscribers.delete(listener); if (!subscribers.size) window.removeEventListener("storage", storage); };
}

/** Bindings are independent of object style drafts and template array order. */
export function setDrawingTemplateBinding(type: DrawingType, id: string, shortcut: DrawingTemplateShortcut | null) {
  getSnapshot();
  const group: Record<string, DrawingTemplateShortcut> = Object.assign(Object.create(null), snapshot[type]);
  if (shortcut) group[id] = shortcut;
  else delete group[id];
  snapshot = { ...snapshot, [type]: group };
  let saved = true;
  try { window.localStorage.setItem(DRAWING_TEMPLATE_SHORTCUTS_KEY, JSON.stringify({ version: 1, bindings: snapshot })); }
  catch { saved = false; }
  emit();
  return saved;
}

export function useDrawingTemplateBindings() {
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
