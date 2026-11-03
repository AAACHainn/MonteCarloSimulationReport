import { describe, expect, it, vi } from "vitest";
import type { IPriceLine, PriceLineOptions } from "lightweight-charts";
import { layoutPriceLineLabels, syncPriceLine } from "./price-lines";

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

describe("nearby order badges", () => {
  it("keeps nearby badges distinct while retaining source order", () => {
    const result = layoutPriceLineLabels([100, 101, 80, 200], 400);
    expect(result[0] - result[2]).toBeGreaterThanOrEqual(34);
    expect(result[1] - result[0]).toBeGreaterThanOrEqual(34);
    expect(result[3]).toBe(200);
  });
  it("keeps badges inside the pane and leaves offscreen prices offscreen", () => {
    const result = layoutPriceLineLabels([-50, 395, 394, 700], 400);
    expect(result[0]).toBe(-50);
    expect(result[3]).toBe(700);
    expect(result[1]).toBeLessThanOrEqual(383);
    expect(result[1] - result[2]).toBeGreaterThanOrEqual(34);
  });
});
