import { describe, expect, it } from "vitest";
import { segmentIntersectsViewport } from "./drawing-viewport";

describe("finite drawing viewport clipping", () => {
  it("keeps a segment crossing the viewport with both endpoints outside", () => {
    expect(segmentIntersectsViewport({ x: -100, y: 50 }, { x: 200, y: 50 }, 100, 100)).toBe(true);
    expect(segmentIntersectsViewport({ x: -100, y: -100 }, { x: 200, y: 200 }, 100, 100)).toBe(true);
  });
  it("rejects lines whose bounding box overlaps but whose segment misses the viewport", () => {
    expect(segmentIntersectsViewport({ x: -100, y: 20 }, { x: 20, y: -100 }, 100, 100)).toBe(false);
  });
  it("preserves hit padding and degenerate points", () => {
    expect(segmentIntersectsViewport({ x: -6, y: 30 }, { x: -6, y: 80 }, 100, 100)).toBe(true);
    expect(segmentIntersectsViewport({ x: -8, y: 30 }, { x: -8, y: 80 }, 100, 100)).toBe(false);
    expect(segmentIntersectsViewport({ x: 50, y: 50 }, { x: 50, y: 50 }, 100, 100)).toBe(true);
  });
});
