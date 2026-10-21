"use client";

import { useCallback, useEffect, useRef } from "react";

/** Ordinary drawing writes belong to the dataset/session/projection, not to a text editor. */
export function useDrawingScopeGuard(scope: string) {
  const generation = useRef({ scope });
  if (generation.current.scope !== scope) generation.current = { scope };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return useCallback(() => {
    const captured = generation.current;
    return () => alive.current && generation.current === captured;
  }, []);
}
