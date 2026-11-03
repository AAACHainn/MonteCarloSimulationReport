import type { CreatePriceLineOptions, IPriceLine, PriceLineOptions } from "lightweight-charts";

/** Separate nearby price badges without moving the actual order prices. */
export function layoutPriceLineLabels(coordinates: number[], height: number, spacing = 34) {
  const result = [...coordinates];
  if (height < spacing) return result;
  const visible = coordinates.map((y, index) => ({ y, index })).filter(item => item.y >= 0 && item.y <= height).sort((a, b) => a.y - b.y);
  const gap = Math.min(spacing, (height - spacing) / Math.max(1, visible.length - 1));
  let previous = -Infinity;
  for (const item of visible) {
    result[item.index] = Math.max(spacing / 2, item.y, previous + gap);
    previous = result[item.index];
  }
  let next = height - spacing / 2;
  for (let i = visible.length - 1; i >= 0; i--) {
    result[visible[i].index] = Math.min(result[visible[i].index], next);
    next = result[visible[i].index] - gap;
  }
  return result;
}

/** Keep chart resources stable; a fresh account snapshot rarely changes their options. */
export function syncPriceLine(lines: Map<string, IPriceLine>, key: string, options: CreatePriceLineOptions,
  create: (options: CreatePriceLineOptions) => IPriceLine) {
  const line = lines.get(key);
  if (!line) { lines.set(key, create(options)); return; }
  const current = line.options();
  if ((Object.keys(options) as (keyof PriceLineOptions)[]).some(field => options[field] !== current[field])) {
    line.applyOptions(options);
  }
}
