"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { copy } from "@/lib/i18n";
import { createHistoricalPlayback } from "@/lib/market-replay/historical-playback";

export function useHistoricalPlayback(options: Omit<Parameters<typeof createHistoricalPlayback>[0], "loadFailed"> & { seconds: number; disabled: boolean }) {
  const latest = useRef(options);
  latest.current = options;
  const [engine] = useState(() => createHistoricalPlayback({ endSequence: options.endSequence,
    getTimeline: () => latest.current.getTimeline(), readLater: (after, signal) => latest.current.readLater(after, signal),
    loadFailed: copy.paperTrading.historicalReplayLoadFailed }));
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  useEffect(() => {
    if (!state.playing || state.busy || options.disabled) {
      setCountdownSeconds(null);
      return;
    }
    const duration = options.seconds * 1000 / state.rate;
    const deadline = performance.now() + duration;
    const tick = () => setCountdownSeconds(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
    tick();
    const clock = setInterval(tick, 250);
    const timer = setTimeout(() => {
      setCountdownSeconds(null);
      // A pause/background event can arrive before React commits the effect cleanup.
      if (engine.getSnapshot().playing && !latest.current.disabled && !document.hidden) void engine.step();
    }, duration);
    return () => { clearInterval(clock); clearTimeout(timer); };
  }, [engine, state.playing, state.busy, state.boundary, state.rate, options.seconds, options.disabled]);
  useEffect(() => {
    const pause = () => { if (document.hidden) engine.pause(); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, [engine]);
  useEffect(() => () => engine.pause(), [engine]);
  return { ...state, countdownSeconds, engine };
}
