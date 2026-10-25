"use client";

import { useCallback, useRef } from "react";
import { copy } from "@/lib/i18n";
import type { ReplayState } from "@/lib/market-replay/types";
import type { useReplayCore } from "./use-replay-core";

type SaveCore = Pick<ReturnType<typeof useReplayCore>, "fetch" | "pendingSaveRef" | "saveTimerRef" | "lastSaveAtRef" | "saveChainRef" | "setSaveStatus">;

export function useReplayPreferenceSave(datasetId: string, core: SaveCore) {
  const { fetch, pendingSaveRef, saveTimerRef, lastSaveAtRef, saveChainRef, setSaveStatus } = core;
  const saveErrorRef = useRef<Error | null>(null);
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const next = pendingSaveRef.current;
    if (!next) return;
    pendingSaveRef.current = null;
    lastSaveAtRef.current = Date.now();
    setSaveStatus("saving");
    const save = saveChainRef.current.catch(() => undefined).then(async () => {
      saveErrorRef.current = null;
      const response = await fetch(`/api/market-datasets/${datasetId}/progress`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startSequence: next.startSequence, currentSequence: next.currentSequence,
          playbackRate: next.playbackRate, displayIntervalSeconds: next.displayIntervalSeconds, displaySession: next.displaySession }),
      });
      if (!response.ok) throw new Error(copy.marketReplay.saveError);
      setSaveStatus("saved");
    }).catch(() => {
      saveErrorRef.current = new Error(copy.marketReplay.saveError);
      // Keep the latest draft for explicit retry, without a background retry loop.
      if (saveChainRef.current === save) pendingSaveRef.current ??= next;
      setSaveStatus("error");
    });
    saveChainRef.current = save;
  }, [datasetId, fetch, lastSaveAtRef, pendingSaveRef, saveChainRef, saveTimerRef, setSaveStatus]);

  const queueSave = useCallback((next: ReplayState, immediate: boolean) => {
    pendingSaveRef.current = next;
    if (immediate) { flushSave(); return; }
    if (saveTimerRef.current) return;
    const delay = Math.max(0, 1_000 - (Date.now() - lastSaveAtRef.current));
    saveTimerRef.current = setTimeout(flushSave, delay);
  }, [flushSave, lastSaveAtRef, pendingSaveRef, saveTimerRef]);

  const flushPreferences = useCallback(async () => {
    // Start/reset flows can explicitly discard a completed failed draft.
    if (!pendingSaveRef.current) saveErrorRef.current = null;
    // Capture a confirmation's session version only after all local preference writes.
    let chain: Promise<void>;
    do {
      flushSave();
      chain = saveChainRef.current;
      await chain;
      if (saveErrorRef.current) throw saveErrorRef.current;
    } while (pendingSaveRef.current || chain !== saveChainRef.current);
  }, [flushSave, pendingSaveRef, saveChainRef]);

  return { queueSave, flushPreferences };
}
