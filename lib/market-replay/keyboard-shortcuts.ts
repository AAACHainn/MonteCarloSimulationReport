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

/** Every physical press survives key release; repeats belong to that specific hold. */
export function createReplayStepShortcut() {
  let hold: object | null = null;
  return {
    keyDown(event: ShortcutKeyEvent & { repeat: boolean }, platform: ReplayShortcutPlatform): (() => boolean) | null {
      if (!isReplayPlaybackShortcut(event, "ArrowRight", platform)) return null;
      if (!event.repeat) {
        hold = {};
        return () => true;
      }
      const repeatedHold = hold;
      return repeatedHold ? () => hold === repeatedHold : null;
    },
    keyUp(event: Pick<KeyboardEvent, "key">, platform: ReplayShortcutPlatform) {
      if (event.key === "ArrowRight" || event.key === (platform === "mac" ? "Meta" : "Control")) hold = null;
    },
    release() { hold = null; },
  };
}

export function replayDrawingShortcutKey(event: ShortcutKeyEvent): "TREND_LINE" | "FIB_RETRACEMENT" | "RECTANGLE" | "TEXT" | null {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey) return null;
  // Option changes event.key on macOS; prefer physical keys for all drawing tools.
  const key = event.code === "KeyT" ? "t" : event.code === "KeyF" ? "f" : event.code === "KeyR" ? "r"
    : !event.code || event.code === "Unidentified" ? event.key.toLowerCase() : null;
  if (event.shiftKey && !event.altKey) return key === "r" ? "RECTANGLE" : key === "t" ? "TEXT" : null;
  if (event.altKey && !event.shiftKey) return key === "t" ? "TREND_LINE" : key === "f" ? "FIB_RETRACEMENT" : null;
  return null;
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

/** Retained floating windows stay in the DOM while closed. Only visible dialogs
 * should reserve page-wide shortcuts; modal and alert dialogs still block them. */
export function hasVisibleReplayDialog() {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
    .some(dialog => !dialog.closest('[aria-hidden="true"], [hidden], [inert]') && dialog.getClientRects().length > 0);
}
