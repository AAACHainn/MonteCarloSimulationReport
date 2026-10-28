"use client";

import { useEffect, useState } from "react";
import { parseAbcdPreferences } from "@/lib/market-replay/chart-drawings";
const STORAGE_KEY = "market-replay-abcd-preferences-v1";

export function useAbcdPreferences() {
  const [abcdPreferences, setAbcdPreferences] = useState(() => parseAbcdPreferences(null));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try { setAbcdPreferences(parseAbcdPreferences(window.localStorage.getItem(STORAGE_KEY))); }
    catch { /* Defaults remain usable without browser storage. */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(abcdPreferences)); }
    catch { /* Preferences remain available during this page session. */ }
  }, [abcdPreferences, loaded]);
  return { abcdPreferences, setAbcdPreferences };
}
