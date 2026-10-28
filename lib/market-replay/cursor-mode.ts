export type ReplayCursorMode = "pointer" | "crosshair";

export const DEFAULT_REPLAY_CURSOR_MODE: ReplayCursorMode = "crosshair";
export const REPLAY_CURSOR_STORAGE_KEY = "market-replay-cursor-mode";

export function parseReplayCursorMode(value: string | null): ReplayCursorMode {
  return value === "pointer" || value === "crosshair" ? value : DEFAULT_REPLAY_CURSOR_MODE;
}

type CursorStorage = Pick<Storage, "getItem" | "setItem">;
export function readReplayCursorMode(storage: () => CursorStorage): ReplayCursorMode {
  try { return parseReplayCursorMode(storage().getItem(REPLAY_CURSOR_STORAGE_KEY)); }
  catch { return DEFAULT_REPLAY_CURSOR_MODE; }
}

export function writeReplayCursorMode(storage: () => CursorStorage, mode: ReplayCursorMode): void {
  try { storage().setItem(REPLAY_CURSOR_STORAGE_KEY, mode); } catch { /* Continue with in-memory preference. */ }
}

export type ReplayChartCursor = "" | "crosshair" | "ns-resize" | "move" | "pointer";

/** Interactive tools may temporarily override the user's mouse cursor. */
export function resolveReplayCursor(mode: ReplayCursorMode, override: ReplayChartCursor): Exclude<ReplayChartCursor, ""> | "default" {
  return override || (mode === "pointer" ? "default" : "crosshair");
}

/** A measurement temporarily replaces the chart crosshair with its own overlay. */
export function replayCrosshairVisible(measuring: boolean) {
  return !measuring;
}
