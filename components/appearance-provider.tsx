"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, isAppearance, readAppearance, saveAppearance, type AppearanceMode } from "@/lib/appearance";

const AppearanceContext = createContext<{ mode: AppearanceMode; setMode: (mode: AppearanceMode) => void }>({ mode: DEFAULT_APPEARANCE, setMode: () => {} });

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [mode, setState] = useState<AppearanceMode>(DEFAULT_APPEARANCE);
  const apply = useCallback((next: AppearanceMode) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    setState(next);
  }, []);
  useLayoutEffect(() => {
    // Hydrate from storage without ever writing the server's light fallback back.
    let initial = DEFAULT_APPEARANCE;
    try { initial = readAppearance(window.localStorage); } catch { /* Storage may be blocked. */ }
    apply(initial);
  }, [apply]);
  const setMode = useCallback((next: AppearanceMode) => {
    apply(next);
    try { saveAppearance(window.localStorage, next); } catch { /* Access itself may throw. */ }
  }, [apply]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY && isAppearance(event.newValue)) apply(event.newValue);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [apply]);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export const useAppearance = () => useContext(AppearanceContext);
