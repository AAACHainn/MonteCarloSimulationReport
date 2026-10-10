export type ReplayShortcutPlatform = "windows" | "mac";

type BrowserPlatformInfo = {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
};

type ShortcutKeyEvent = Pick<KeyboardEvent,
  "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing" | "defaultPrevented"
>;

export function detectReplayShortcutPlatform(browser: BrowserPlatformInfo): ReplayShortcutPlatform {
  const platform = browser.userAgentData?.platform || browser.platform;
  const isMac = platform ? /mac/i.test(platform) : /Macintosh|Mac OS X/i.test(browser.userAgent ?? "");
  return isMac ? "mac" : "windows";
}

export function isReplayPlaybackShortcut(
  event: ShortcutKeyEvent,
  key: "ArrowDown" | "ArrowRight",
  platform: ReplayShortcutPlatform,
) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || event.key !== key) return false;
  return platform === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export function replayDrawingShortcutKey(event: ShortcutKeyEvent): "t" | "f" | null {
  if (event.defaultPrevented || event.isComposing || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  // Option changes event.key on macOS; match the physical T/F keys instead.
  if (event.code === "KeyT") return "t";
  if (event.code === "KeyF") return "f";
  if (event.code && event.code !== "Unidentified") return null;
  const key = event.key.toLowerCase();
  return key === "t" || key === "f" ? key : null;
}

export function isReplayDrawingDeleteShortcut(event: ShortcutKeyEvent) {
  return !event.defaultPrevented && !event.isComposing
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
    && (event.key === "Delete" || event.key === "Backspace");
}

export function isReplayShortcutInputTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='dialog'], [role='alertdialog']",
  ));
}
