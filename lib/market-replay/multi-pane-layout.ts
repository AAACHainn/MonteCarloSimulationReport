import { isValidDisplayInterval } from "./types";

export type PaneId = 1 | 2 | 3 | 4 | 5;
export const paneIds = [1, 2, 3, 4, 5] as const;
type Split = { axis: "x" | "y"; children: [LayoutNode, LayoutNode]; ratio: number };
type LayoutNode = PaneId | Split;
const split = (axis: Split["axis"], first: LayoutNode, second: LayoutNode, ratio = .5): Split =>
  ({ axis, children: [first, second], ratio });
export const layouts = {
  single: 1,
  side: split("x", 1, 2),
  stacked: split("y", 1, 2),
  leftTwo: split("x", 1, split("y", 2, 3)),
  topTwo: split("y", 1, split("x", 2, 3)),
  grid: split("y", split("x", 1, 2), split("x", 3, 4)),
  leftThree: split("x", 1, split("y", 2, split("y", 3, 4), 1 / 3)),
  topFour: split("y", 1, split("y", split("x", 2, 3), split("x", 4, 5)), 1 / 3),
  leftFour: split("x", 1, split("y", split("x", 2, 3), split("x", 4, 5)), 1 / 3),
} satisfies Record<string, LayoutNode>;
export type LayoutId = keyof typeof layouts;
export type LayoutRatios = Partial<Record<LayoutId, Record<string, number>>>;
type Size = { width: number; height: number };
export type PaneRect = Size & { x: number; y: number };
export const paneGap = 2;
const minimumPane: Size = { width: 210, height: 156 };

function minimum(node: LayoutNode): Size {
  if (typeof node === "number") return minimumPane;
  const [a, b] = node.children.map(minimum);
  return node.axis === "x"
    ? { width: a.width + b.width + paneGap, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + paneGap };
}

export function paneLayout(id: LayoutId, size: Size, ratios: LayoutRatios, maximized: PaneId | null) {
  const panes = new Map<PaneId, PaneRect>();
  const dividers: Array<{ key: string; axis: Split["axis"]; rect: PaneRect; ratio: number; available: number; min: number; max: number }> = [];
  const node = layouts[id], required = minimum(node);
  const fits = size.width >= required.width && size.height >= required.height;
  function place(part: LayoutNode, rect: PaneRect, key: string) {
    if (typeof part === "number") { panes.set(part, rect); return; }
    const [a, b] = part.children;
    const horizontal = part.axis === "x", dimension = horizontal ? "width" : "height";
    const available = rect[dimension] - paneGap;
    const min = minimum(a)[dimension] / available, max = 1 - minimum(b)[dimension] / available;
    const saved = ratios[id]?.[key];
    const ratio = Math.max(min, Math.min(max, Number.isFinite(saved) ? saved! : part.ratio));
    const first = Math.round(available * ratio);
    place(a, { ...rect, [dimension]: first }, key + "0");
    const offset = first + paneGap;
    const coordinate = horizontal ? "x" : "y";
    place(b, { ...rect, [coordinate]: rect[coordinate] + offset, [dimension]: available - first }, key + "1");
    dividers.push({ key, axis: part.axis, ratio, available, min, max,
      rect: { ...rect, [coordinate]: rect[coordinate] + first, [dimension]: paneGap } });
  }
  place(fits ? maximized ?? node : 1, { ...size, x: 0, y: 0 }, "root");
  return { panes, dividers, fits };
}

export function secondaryIntervals(source: number | null, main: number, presets: readonly number[], stored: readonly (number | null)[]) {
  const used = new Set([main, ...stored.filter((value): value is number => value !== null && source !== null && isValidDisplayInterval(source, value))]);
  return paneIds.slice(1).map((_, index) => {
    const value = stored[index];
    if (value != null && source !== null && isValidDisplayInterval(source, value)) return value;
    const next = [...presets].sort((a, b) => a - b).find(period => source !== null && isValidDisplayInterval(source, period) && !used.has(period)) ?? main;
    used.add(next);
    return next;
  });
}
