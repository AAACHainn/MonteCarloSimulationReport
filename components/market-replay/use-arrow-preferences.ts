"use client";

import { useEffect, useState } from "react";
import { parseArrowPreferences, type ArrowDrawingType, type ArrowPreferences } from "@/lib/market-replay/chart-drawings";

const STORAGE_KEYS: Record<ArrowDrawingType, string> = {
  ARROW_UP: "market-replay-arrow-up-preferences-v1", ARROW_DOWN: "market-replay-arrow-down-preferences-v1",
};
const defaults = () => ({ ARROW_UP: parseArrowPreferences(null, "ARROW_UP"), ARROW_DOWN: parseArrowPreferences(null, "ARROW_DOWN") });

export function useArrowPreferences() {
  const [arrowPreferences, setArrowPreferences] = useState<Record<ArrowDrawingType, ArrowPreferences>>(defaults);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const read = (type: ArrowDrawingType) => {
      try { return parseArrowPreferences(window.localStorage.getItem(STORAGE_KEYS[type]), type); }
      catch { return parseArrowPreferences(null, type); }
    };
    setArrowPreferences({ ARROW_UP: read("ARROW_UP"), ARROW_DOWN: read("ARROW_DOWN") });
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    for (const type of ["ARROW_UP", "ARROW_DOWN"] as const) {
      try { window.localStorage.setItem(STORAGE_KEYS[type], JSON.stringify(arrowPreferences[type])); }
      catch { /* The current page retains usable preferences when storage is unavailable. */ }
    }
  }, [arrowPreferences, loaded]);
  return { arrowPreferences, setArrowPreferences };
}
