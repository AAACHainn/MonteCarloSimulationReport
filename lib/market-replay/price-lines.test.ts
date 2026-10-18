import { expect, it, vi } from "vitest";
import type { IPriceLine, PriceLineOptions } from "lightweight-charts";
import { syncPriceLine } from "./price-lines";

it("keeps unchanged price lines and updates moved, renamed, recolored and drag-previewed lines in place", () => {
  const lines = new Map<string, IPriceLine>();
  const create = vi.fn((options: Partial<PriceLineOptions>) => {
    let current = { ...options };
    return { options: () => current, applyOptions: vi.fn((next: Partial<PriceLineOptions>) => { current = { ...current, ...next }; }) } as IPriceLine;
  });
  const options = { price: 100, color: "red", title: "stop" };
  syncPriceLine(lines, "order", options, create);
  const line = lines.get("order")!;
  for (let i = 0; i < 100; i++) syncPriceLine(lines, "order", { ...options }, create);
  expect(create).toHaveBeenCalledTimes(1);
  expect(line.applyOptions).not.toHaveBeenCalled();
  syncPriceLine(lines, "order", { ...options, price: 101, title: "moved", color: "green" }, create);
  expect(line.applyOptions).toHaveBeenCalledTimes(1);
  line.applyOptions({ price: 102 }); // unsaved drag preview
  syncPriceLine(lines, "order", { ...options, price: 101, title: "moved", color: "green" }, create);
  expect(line.options().price).toBe(101);
  expect(lines.get("order")).toBe(line);
  lines.delete("order"); // cancellation followed by a new order allocates a new resource
  syncPriceLine(lines, "new-order", options, create);
  expect(create).toHaveBeenCalledTimes(2);
});
