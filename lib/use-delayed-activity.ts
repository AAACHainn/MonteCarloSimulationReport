"use client";

import { useEffect, useState } from "react";

/** Short background work stays quiet; completion and cancellation clear immediately. */
export function useDelayedActivity(active: boolean, delayMs = 1_000) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!active) return;
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && visible;
}
