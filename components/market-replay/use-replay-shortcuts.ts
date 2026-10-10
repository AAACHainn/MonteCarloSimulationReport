"use client";

import { useSyncExternalStore } from "react";
import { copy } from "@/lib/i18n";
import { detectReplayShortcutPlatform, type ReplayShortcutPlatform } from "@/lib/market-replay/keyboard-shortcuts";

const subscribe = () => () => undefined;
const getServerPlatform = (): ReplayShortcutPlatform => "windows";
const getBrowserPlatform = (): ReplayShortcutPlatform => typeof navigator === "undefined"
  ? getServerPlatform() : detectReplayShortcutPlatform(navigator);

export function useReplayShortcuts() {
  const platform = useSyncExternalStore(subscribe, getBrowserPlatform, getServerPlatform);
  const isMac = platform === "mac";
  const modifier = isMac ? copy.marketReplay.shortcutCommand : copy.marketReplay.shortcutControl;
  const drawingModifier = isMac ? copy.marketReplay.shortcutOption : copy.marketReplay.shortcutAlt;
  const ariaModifier = isMac ? "Meta" : "Control";

  return {
    platform,
    playback: copy.marketReplay.playbackShortcut(modifier),
    nextBar: copy.marketReplay.nextBarShortcut(modifier),
    trendLine: copy.marketReplay.trendLineShortcut(drawingModifier),
    fibonacciRetracement: copy.marketReplay.fibonacciRetracementShortcut(drawingModifier),
    deleteDrawing: isMac ? copy.marketReplay.shortcutBackspace : copy.marketReplay.shortcutDelete,
    playbackAria: `${ariaModifier}+ArrowDown`,
    nextBarAria: `${ariaModifier}+ArrowRight`,
  };
}
