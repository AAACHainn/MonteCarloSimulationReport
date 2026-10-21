"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createUuid } from "@/lib/uuid";
import { copy } from "@/lib/i18n";
import type { MarketDrawing, MarketDrawingStyle, DrawingGeometry, NewMarketDrawing } from "@/lib/market-replay/chart-drawings";
import { drawingGeometryMatchesType, drawingStyleMatchesType } from "@/lib/market-replay/chart-drawings";

type DrawingPayload = { drawings: MarketDrawing[]; drawing?: MarketDrawing; error?: string };

export function useHistoricalDrawings({ datasetId, fetch }: {
  datasetId: string; fetch: typeof globalThis.fetch;
}) {
  const [drawings, setDrawings] = useState<MarketDrawing[]>([]);
  const current = useRef(drawings);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const readGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/market-datasets/${datasetId}/drawings`;
  const publish = useCallback((next: MarketDrawing[]) => { current.current = next; setDrawings(next); }, []);
  const invalidateReads = useCallback(() => { readGeneration.current++; }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (locked.current && !signal) return false;
    const generation = ++readGeneration.current;
    locked.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(url, { signal });
      const data = await response.json() as DrawingPayload;
      if (!response.ok) throw new Error(data.error || copy.marketReplay.drawingLoadError);
      if (signal?.aborted || generation !== readGeneration.current) return false;
      publish(data.drawings);
      loadedRef.current = true; setLoaded(true);
      return true;
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : copy.marketReplay.drawingLoadError);
      return false;
    } finally { if (generation === readGeneration.current) { locked.current = false; setBusy(false); } }
  }, [fetch, publish, url]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => { controller.abort(); invalidateReads(); };
  }, [refresh, invalidateReads]);

  const mutate = useCallback(async (next: MarketDrawing[], method: string, suffix: string, body: unknown,
    reconcile: (payload: DrawingPayload) => MarketDrawing[], failure: string) => {
    if (!loadedRef.current || locked.current) return false;
    locked.current = true; setBusy(true); setError(null);
    const previous = current.current;
    const generation = readGeneration.current;
    try {
      publish(next);
      const response = await fetch(url + suffix, { method, headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json() as DrawingPayload;
      if (generation !== readGeneration.current) return false;
      if (!response.ok) throw new Error(data.error || failure);
      publish(reconcile(data));
      return true;
    } catch (cause) {
      if (generation === readGeneration.current) { publish(previous); setError(cause instanceof Error ? cause.message : failure); } return false;
    } finally { if (generation === readGeneration.current) { locked.current = false; setBusy(false); } }
  }, [fetch, publish, url]);

  const create = async (drawing: NewMarketDrawing) => {
    const timestamp = new Date().toISOString();
    const optimistic = { ...drawing, id: `temporary-${createUuid()}`,
      createdAt: timestamp, updatedAt: timestamp } as MarketDrawing;
    let saved = optimistic;
    const next = drawing.type === "TEXT" ? current.current : [...current.current, optimistic];
    const ok = await mutate(next, "POST", "", { type: drawing.type, geometry: drawing.geometry, style: drawing.style }, payload => {
      if (!payload.drawing) throw new Error(copy.marketReplay.drawingSaveError);
      saved = payload.drawing;
      return drawing.type === "TEXT" ? [...next, saved] : next.map(item => item.id === optimistic.id ? saved : item);
    }, copy.marketReplay.drawingSaveError);
    return ok ? saved : null;
  };
  const update = async (id: string, patch: { geometry?: DrawingGeometry; style?: MarketDrawingStyle }) => {
    const previous = current.current.find(item => item.id === id);
    if (!previous) return false;
    if (patch.geometry && !drawingGeometryMatchesType(previous.type, patch.geometry)) return false;
    if (patch.style && !drawingStyleMatchesType(previous.type, patch.style)) return false;
    if ((!patch.geometry || JSON.stringify(patch.geometry) === JSON.stringify(previous.geometry))
      && (!patch.style || JSON.stringify(patch.style) === JSON.stringify(previous.style))) return true;
    const next = current.current.map(item => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } as MarketDrawing : item);
    return mutate(next, "PATCH", `/${encodeURIComponent(id)}`, patch, payload => {
      if (!payload.drawing) throw new Error(copy.marketReplay.drawingSaveError);
      return next.map(item => item.id === id ? payload.drawing! : item);
    }, copy.marketReplay.drawingSaveError);
  };
  const remove = (id: string) => mutate(current.current.filter(item => item.id !== id), "DELETE", `/${encodeURIComponent(id)}`, undefined,
    () => current.current.filter(item => item.id !== id), copy.marketReplay.drawingDeleteError);
  const clear = () => mutate([], "DELETE", "", { ids: current.current.map(item => item.id) }, payload => payload.drawings, copy.marketReplay.drawingDeleteError);
  return { drawings, loaded, busy, error, refresh, create, update, remove, clear };
}
