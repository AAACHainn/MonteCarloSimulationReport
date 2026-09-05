"use client";

import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { ReplayState } from "./types";

/** Network and keyboard handlers must see a committed sequence before React renders again. */
export function useReplayState() {
  const [replay, setState] = useState<ReplayState | null>(null);
  const replayRef = useRef<ReplayState | null>(null);
  const setReplay = useCallback((action: SetStateAction<ReplayState | null>) => {
    const next = typeof action === "function" ? action(replayRef.current) : action;
    replayRef.current = next;
    setState(next);
  }, []);
  return [replay, setReplay, replayRef] as const;
}
