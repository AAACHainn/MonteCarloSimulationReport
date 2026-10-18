import type { CreatePriceLineOptions, IPriceLine, PriceLineOptions } from "lightweight-charts";

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
