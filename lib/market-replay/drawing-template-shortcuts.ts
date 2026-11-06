import type { DrawingType, MarketDrawingStyle } from "./chart-drawings";
import { DRAWING_TYPES, drawingStyleMatchesType } from "./chart-drawings";
import { abcdSettingsStyle } from "./abcd-style";
import { isReplayDrawingDeleteShortcut, isReplayPlaybackShortcut, replayDrawingShortcutKey, type ReplayShortcutPlatform } from "./keyboard-shortcuts";

export type DrawingTemplateShortcut = {
  code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean;
};
export type DrawingTemplateBindings = Partial<Record<DrawingType, Record<string, DrawingTemplateShortcut>>>;
export type DrawingStyleTemplate = { id: string; name: string; style: MarketDrawingStyle };
export type DrawingTemplateCatalog = Partial<Record<DrawingType, readonly DrawingStyleTemplate[]>>;
type Key = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;
const supportedCode = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Delete|Backspace|Escape|Tab|Enter|Space|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash)$/;
const modifiers = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

export function drawingTemplateShortcut(event: Key): DrawingTemplateShortcut | null {
  if (modifiers.has(event.key)) return null;
  let code = event.code;
  if (!code || code === "Unidentified") {
    code = /^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}`
      : /^\d$/.test(event.key) ? `Digit${event.key}` : event.key;
  }
  if (!supportedCode.test(code)) return null;
  return { code, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey };
}

export function sameDrawingTemplateShortcut(a: DrawingTemplateShortcut, b: DrawingTemplateShortcut) {
  return a.code === b.code && a.ctrlKey === b.ctrlKey && a.altKey === b.altKey && a.shiftKey === b.shiftKey && a.metaKey === b.metaKey;
}

export type DrawingShortcutConflict = { kind: "tool"; tool: DrawingType } | { kind: "playback"; key: "ArrowRight" | "ArrowDown" }
  | { kind: "interval" | "delete" | "reserved" };

/** Conservative reservation of page controls and common browser/OS shortcuts.
 * Extensions and user-defined OS shortcuts cannot be enumerated by a web page. */
export function drawingShortcutConflict(shortcut: DrawingTemplateShortcut, platform: ReplayShortcutPlatform): DrawingShortcutConflict | null {
  const { code, ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: meta } = shortcut;
  const key = code.startsWith("Key") ? code.slice(3).toLowerCase() : code.startsWith("Digit") ? code.slice(5) : code;
  const event = { ...shortcut, key, isComposing: false, defaultPrevented: false };
  const tool = replayDrawingShortcutKey(event);
  if (tool) return { kind: "tool", tool };
  for (const arrow of ["ArrowRight", "ArrowDown"] as const) {
    if (isReplayPlaybackShortcut(event, arrow, "windows") || isReplayPlaybackShortcut(event, arrow, "mac")) return { kind: "playback", key: arrow };
  }
  if (isReplayDrawingDeleteShortcut(event)) return { kind: "delete" };
  if (!ctrl && !alt && !shift && !meta && /^(Digit|Numpad)\d$/.test(code)) return { kind: "interval" };
  if (["Escape", "Tab", "Enter"].includes(code)) return { kind: "reserved" };
  if (platform === "windows" && meta) return { kind: "reserved" };
  if (/^F(1|[3-9]|1[0-2])$/.test(code)) return { kind: "reserved" };
  if (ctrl && alt && ["Delete", "Backspace"].includes(code)) return { kind: "reserved" };
  if ((ctrl || meta) && shift && ["Delete", "Backspace"].includes(code)) return { kind: "reserved" };
  if (alt && (/^Numpad/.test(code) || ["ArrowLeft", "ArrowRight", "Home", "Space", "F4"].includes(code)
    || !ctrl && !meta && /^(KeyD|KeyE|KeyF)$/.test(code))) return { kind: "reserved" };
  if ((ctrl || meta) && !alt && (/^(Digit|Numpad)\d$/.test(code)
    || /^(Key[A-Z]|Minus|Equal|BracketLeft|BracketRight|Backslash|PageUp|PageDown|Space)$/.test(code))) return { kind: "reserved" };
  if (!ctrl && !alt && !meta && (!shift && /^(Space|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(code)
    || shift && ["Delete", "Space"].includes(code))) return { kind: "reserved" };
  return null;
}

export function formatDrawingTemplateShortcut(shortcut: DrawingTemplateShortcut, platform: ReplayShortcutPlatform) {
  const labels: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Space",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`", Comma: ",", Period: ".", Slash: "/" };
  const key = shortcut.code.startsWith("Key") ? shortcut.code.slice(3) : shortcut.code.startsWith("Digit") ? shortcut.code.slice(5)
    : shortcut.code.startsWith("Numpad") ? `Num ${shortcut.code.slice(6)}` : labels[shortcut.code] ?? shortcut.code;
  return [shortcut.ctrlKey && "Ctrl", shortcut.altKey && (platform === "mac" ? "Option" : "Alt"), shortcut.shiftKey && "Shift",
    shortcut.metaKey && (platform === "mac" ? "⌘" : "Win"), key].filter(Boolean).join("+");
}

export function parseDrawingTemplateBindings(raw: string | null): DrawingTemplateBindings {
  const result: DrawingTemplateBindings = {};
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || value.version !== 1 || !value.bindings) return result;
    for (const type of DRAWING_TYPES) {
      const group = value.bindings[type];
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      const entries: [string, DrawingTemplateShortcut][] = [];
      for (const [id, candidate] of Object.entries(group)) {
        if (!id || !candidate || typeof candidate !== "object") continue;
        const item = candidate as DrawingTemplateShortcut;
        if (typeof item.code !== "string" || !supportedCode.test(item.code)
          || ![item.ctrlKey, item.altKey, item.shiftKey, item.metaKey].every(v => typeof v === "boolean")) continue;
        const shortcut = { code: item.code, ctrlKey: item.ctrlKey, altKey: item.altKey, shiftKey: item.shiftKey, metaKey: item.metaKey };
        if (!entries.some(([, other]) => sameDrawingTemplateShortcut(shortcut, other))) entries.push([id, shortcut]);
        if (entries.length === 50) break;
      }
      if (entries.length) result[type] = Object.assign(Object.create(null), Object.fromEntries(entries));
    }
  } catch { /* Preserve defaults when optional browser preferences are unavailable or corrupt. */ }
  return result;
}

export function drawingTemplateStyle(type: DrawingType, style: MarketDrawingStyle): MarketDrawingStyle | null {
  if (!drawingStyleMatchesType(type, style)) return null;
  if (type === "AB_CD" && "levels" in style) return abcdSettingsStyle(style);
  return "levels" in style ? { ...style, levels: style.levels.map(level => ({ ...level })) } : { ...style };
}
