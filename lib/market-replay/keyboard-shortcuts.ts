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

export function replayDrawingShortcutKey(event: ShortcutKeyEvent): "t" | "f" | "r" | null {
  if (event.defaultPrevented || event.isComposing || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  // Option changes event.key on macOS; match the physical T/F keys instead.
  if (event.code === "KeyT") return "t";
  if (event.code === "KeyF") return "f";
  if (event.code === "KeyR") return "r";
  if (event.code && event.code !== "Unidentified") return null;
  const key = event.key.toLowerCase();
  return key === "t" || key === "f" || key === "r" ? key : null;
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
