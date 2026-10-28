"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_REPLAY_CURSOR_MODE, readReplayCursorMode, writeReplayCursorMode, REPLAY_CURSOR_STORAGE_KEY, type ReplayCursorMode } from "@/lib/market-replay/cursor-mode";

export function useReplayCursorPreference() {
  const [mode, setMode] = useState<ReplayCursorMode>(DEFAULT_REPLAY_CURSOR_MODE);
  useEffect(() => {
    setMode(readReplayCursorMode(() => window.localStorage));
    const onStorage = (event: StorageEvent) => {
      if (event.key === REPLAY_CURSOR_STORAGE_KEY || event.key === null) {
        setMode(readReplayCursorMode(() => window.localStorage));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const updateMode = useCallback((value: ReplayCursorMode) => {
    setMode(value);
    writeReplayCursorMode(() => window.localStorage, value);
  }, []);
  return [mode, updateMode] as const;
}
