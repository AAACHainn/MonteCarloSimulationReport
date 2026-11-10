"use client";

import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { copy } from "@/lib/i18n";
import type { MarketDrawing } from "@/lib/market-replay/chart-drawings";
import { type DrawingHistory, sameDrawingSnapshot } from "@/lib/market-replay/drawing-history";
import { runDrawingWrite } from "@/lib/market-replay/drawing-write-queue";
import type { DrawingNudgeKey } from "@/lib/market-replay/keyboard-shortcuts";
import type { TextDrawingApi } from "@/lib/market-replay/text-drawing-primitive";

type Move = { before: MarketDrawing; after: MarketDrawing };
type Gesture = Move & { key: DrawingNudgeKey; steps: number };

function newSession() {
  return {
    gesture: null as Gesture | null,
    previews: new Map<string, MarketDrawing>(),
    pending: 0,
    failed: false,
    tail: Promise.resolve(true),
  };
}

// A lost response can be retried with the same snapshots. The transaction also
// accepts a retry when the saved object already matches the requested result.
async function saveMove(fetch: typeof globalThis.fetch, url: string, move: Move, isCurrent: () => boolean) {
  const request = { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes: [{ id: move.before.id, ...move }] }) };
  for (let attempt = 0; attempt < 2 && isCurrent(); attempt++) {
    const response = await fetch(`${url}/changes`, request).catch(() => null);
    if (response?.status === 409) return { kind: "conflict" } as const;
    if (response?.ok) {
      const data = await response.json().catch(() => null) as { drawings?: MarketDrawing[] } | null;
      const saved = data?.drawings?.[0];
      if (saved && sameDrawingSnapshot(saved, move.after)) return { kind: "saved", saved } as const;
    } else if (response && response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)) {
      return { kind: attempt === 0 ? "rejected" : "unknown" } as const;
    }
  }
  return { kind: "unknown" } as const;
}

export function useDrawingNudge(options: {
  datasetId: string;
  scope: string;
  fetch: typeof globalThis.fetch;
  history: DrawingHistory;
  drawings: MarketDrawing[];
  setDrawings: Dispatch<SetStateAction<MarketDrawing[]>>;
  select: (id: string | null) => void;
  selectedDrawingId: string | null;
  chartApi: RefObject<TextDrawingApi | null>;
  onNudgeError?: (error: string | null) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef(newSession());
  const [view, setView] = useState({ previews: new Map<string, MarketDrawing>(), busy: false });
  const isBusy = useCallback(() => Boolean(session.current.gesture || session.current.pending), []);
  const publish = useCallback(() => {
    setView({ previews: new Map(session.current.previews), busy: isBusy() });
  }, [isBusy]);

  useLayoutEffect(() => {
    publish();
    return () => { session.current = newSession(); };
  }, [options.scope, options.history, publish]);

  const finish = useCallback((key?: string) => {
    const current = session.current;
    const move = current.gesture;
    if (!move || (key && move.key !== key)) return;
    current.gesture = null;
    current.pending++;
    const { scope, fetch, datasetId, history } = latest.current;
    const url = `/api/market-datasets/${datasetId}/drawings`;
    const isCurrent = () => session.current === current;
    current.tail = runDrawingWrite(scope, async () => {
      try {
        if (!isCurrent() || current.failed) return false;
        const result = await saveMove(fetch, url, { before: move.before, after: move.after }, isCurrent);
        if (!isCurrent()) return false;
        let saved = result.kind === "saved" ? result.saved : null;
        let refreshed: MarketDrawing[] | null = null;
        if (result.kind === "unknown" || result.kind === "conflict") {
          const response = await fetch(url).catch(() => null);
          const data = response?.ok ? await response.json().catch(() => null) as { drawings?: MarketDrawing[] } | null : null;
          if (!isCurrent()) return false;
          refreshed = Array.isArray(data?.drawings) ? data.drawings : null;
          const actual = refreshed?.find(drawing => drawing.id === move.after.id);
          if (result.kind === "unknown" && actual && sameDrawingSnapshot(actual, move.after)) saved = actual;
        }
        if (refreshed) {
          latest.current.drawings = refreshed;
          latest.current.setDrawings(refreshed);
          const id = latest.current.selectedDrawingId;
          if (id && !refreshed.some(drawing => drawing.id === id)) latest.current.select(null);
        }
        if (saved) {
          const confirmed = saved;
          if (!refreshed) latest.current.setDrawings(drawings => {
            const next = drawings.map(drawing => drawing.id === confirmed.id ? confirmed : drawing);
            latest.current.drawings = next;
            return next;
          });
          history.record([{ id: saved.id, before: move.before, after: saved }], "nudge");
          if (current.previews.get(saved.id) === move.after) current.previews.delete(saved.id);
          return true;
        }

        // Later moves may depend on this move's unconfirmed endpoint.
        current.failed = true;
        current.gesture = null;
        const t = copy.marketReplay;
        if (result.kind === "rejected") {
          latest.current.onNudgeError?.(t.drawingSaveError);
          return false;
        }
        history.clear();
        latest.current.onNudgeError?.(refreshed ? t.drawingEditing.nudgeRefreshed : t.drawingEditing.nudgeRefreshFailed);
        return false;
      } finally {
        current.pending--;
        if (isCurrent()) {
          if (current.failed) current.previews.clear();
          if (!current.pending) current.failed = false;
          publish();
        }
      }
    });
  }, [publish]);

  const press = useCallback((key: DrawingNudgeKey, repeat: boolean, id: string) => {
    const current = session.current;
    if (current.failed) return;
    const drawing = latest.current.drawings.find(item => item.id === id);
    if (!drawing || drawing.id.startsWith("temporary-")) return;
    if (repeat && (current.gesture?.key !== key || current.gesture.before.id !== id)) return;
    if (!repeat) finish();
    const active = current.gesture;
    const before = active?.before ?? current.previews.get(id) ?? drawing;
    const steps = (active?.steps ?? 0) + 1;
    // Prices use total ticks from the start of the hold to avoid rounding drift.
    // Each horizontal step advances from the last representable time anchor.
    const source = key === "ArrowLeft" || key === "ArrowRight" ? active?.after ?? before : before;
    const after = latest.current.chartApi.current?.nudgeDrawing?.(source, key, steps);
    if (!after) return;
    if (!active && !current.pending) latest.current.onNudgeError?.(null);
    current.gesture = { key, steps, before, after };
    current.previews.set(id, after);
    publish();
  }, [finish, publish]);

  const flush = useCallback(async () => {
    finish();
    const current = session.current;
    if (!current.pending) return true;
    const saved = await current.tail;
    return saved && session.current === current;
  }, [finish]);

  return { ...view, isBusy, finish, press, flush };
}
