import type { TextDrawingStyle } from "./chart-drawings";

export const TEXT_PADDING = 6;
export const TEXT_FONT_FAMILY = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export type TextMeasurement = { width: number; actualBoundingBoxLeft?: number; actualBoundingBoxRight?: number;
  actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number };
export type TextMeasure = (text: string, font: string) => TextMeasurement;
export type TextLayout = { lines: string[]; lineHeight: number; width: number; height: number; font: string;
  left: number; right: number; top: number; bottom: number };
export type CachedTextLayout = Omit<TextLayout, "lines"> & { lineCount: number; lineAt: (index: number) => string };

function compactLayout(layout: TextLayout): { layout: CachedTextLayout; bytes: number } {
  const { lines, ...dimensions } = layout;
  const rendered = lines.join("");
  const offsets = new Uint32Array(lines.length + 1);
  for (let i = 0; i < lines.length; i++) offsets[i + 1] = offsets[i] + lines[i].length;
  return { layout: { ...dimensions, lineCount: lines.length, lineAt: index => rendered.slice(offsets[index], offsets[index + 1]) },
    bytes: rendered.length * 2 + offsets.byteLength };
}

let segmenter: Intl.Segmenter | undefined;
export function textGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    segmenter ??= new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), part => part.segment);
  }
  const result: string[] = [];
  let regional = false;
  for (const char of text) {
    const last = result.at(-1);
    const isRegional = /[\u{1F1E6}-\u{1F1FF}]/u.test(char);
    if (last && (/\p{Mark}|[\uFE0E\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/u.test(char)
      || last.endsWith("\u200D") || (isRegional && regional))) result[result.length - 1] += char;
    else result.push(char);
    regional = isRegional && !regional;
  }
  return result;
}

export function layoutDrawingText(text: string, style: TextDrawingStyle, measure: TextMeasure): TextLayout {
  const font = `${style.italic ? "italic " : ""}${style.bold ? "700 " : "400 "}${style.fontSize}px ${TEXT_FONT_FAMILY}`;
  const lines: string[] = [];
  for (const raw of text.replace(/\t/g, "    ").split("\n")) {
    if (!style.wrapEnabled || !raw) { lines.push(raw); continue; }
    const parts = textGraphemes(raw);
    let offset = 0;
    while (offset < parts.length) {
      const remaining = parts.length - offset;
      const fits = (count: number) => measure(parts.slice(offset, offset + count).join(""), font).width <= style.wrapWidth;
      // Exponential bounds avoid repeatedly measuring the entire remaining paragraph.
      let low = 1, high = 2;
      while (high < remaining && fits(high)) { low = high; high *= 2; }
      high = Math.min(high, remaining);
      if (fits(high)) low = high;
      else while (low + 1 < high) { const mid = (low + high) >>> 1; if (fits(mid)) low = mid; else high = mid; }
      let take = low;
      if (take < remaining) {
        for (let index = take - 1; index > 0; index--) {
          if (/\s/u.test(parts[offset + index])) { take = index + 1; break; }
        }
      }
      lines.push(parts.slice(offset, offset + take).join(""));
      offset += take;
    }
  }
  const lineHeight = Math.ceil(style.fontSize * 1.4);
  let width = 0, left = 0, right = 0, top = 0, bottom = lines.length * lineHeight + TEXT_PADDING * 2;
  for (const [index, line] of lines.entries()) {
    const metrics = measure(line, font);
    width = Math.max(width, metrics.width);
    const overhang = style.italic ? style.fontSize / 4 : 0;
    left = Math.min(left, -(metrics.actualBoundingBoxLeft ?? overhang));
    right = Math.max(right, metrics.actualBoundingBoxRight ?? metrics.width + overhang);
    const baseline = TEXT_PADDING + style.fontSize + index * lineHeight;
    top = Math.min(top, baseline - (metrics.actualBoundingBoxAscent ?? style.fontSize));
    bottom = Math.max(bottom, baseline + (metrics.actualBoundingBoxDescent ?? style.fontSize * 0.4));
  }
  const boxWidth = (style.wrapEnabled ? style.wrapWidth : width) + TEXT_PADDING * 2;
  return { lines, lineHeight, font, width: boxWidth, height: lines.length * lineHeight + TEXT_PADDING * 2,
    left: Math.min(0, left + TEXT_PADDING), right: Math.max(boxWidth, right + TEXT_PADDING), top, bottom };
}

type Entry = { text: string; size: number; bold: boolean; italic: boolean; wrap: boolean; wrapWidth: number;
  layout: CachedTextLayout; bytes: number };
export class TextLayoutCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly measure: TextMeasure, private readonly maxEntries = 512, private readonly maxBytes = 8 * 1024 * 1024) {}
  get(id: string, text: string, style: TextDrawingStyle) {
    const old = this.entries.get(id), wrapWidth = style.wrapEnabled ? style.wrapWidth : 0;
    if (old && old.text === text && old.size === style.fontSize && old.bold === style.bold && old.italic === style.italic
      && old.wrap === style.wrapEnabled && old.wrapWidth === wrapWidth) {
      this.entries.delete(id); this.entries.set(id, old); return old.layout;
    }
    this.remove(id);
    const compact = compactLayout(layoutDrawingText(text, style, this.measure));
    const layout = compact.layout;
    const bytes = 256 + text.length * 2 + compact.bytes;
    if (bytes <= this.maxBytes) {
      this.entries.set(id, { text, size: style.fontSize, bold: style.bold, italic: style.italic,
        wrap: style.wrapEnabled, wrapWidth, layout, bytes }); this.bytes += bytes;
      while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!);
    }
    return layout;
  }
  remove(id: string) { const entry = this.entries.get(id); if (entry) { this.bytes -= entry.bytes; this.entries.delete(id); } }
  retain(ids: ReadonlySet<string>) { for (const id of this.entries.keys()) if (!ids.has(id)) this.remove(id); }
  clear() { this.entries.clear(); this.bytes = 0; }
  get stats() { return { entries: this.entries.size, bytes: this.bytes }; }
}
