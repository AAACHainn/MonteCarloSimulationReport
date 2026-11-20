import { describe, expect, it } from "vitest";
import { layouts, paneLayout, secondaryIntervals, type LayoutId } from "./multi-pane-layout";

const dimensions = { width: 1000, height: 600 };
const counts: Record<LayoutId, number> = { single: 1, side: 2, stacked: 2, leftTwo: 3, topTwo: 3, grid: 4, leftThree: 4, topFour: 5, leftFour: 5 };

describe("replay workspace layouts", () => {
  it.each(Object.keys(layouts) as LayoutId[])("keeps window identity and non-overlapping chart bounds in %s", layout => {
    const { panes, dividers } = paneLayout(layout, dimensions, {}, null);
    expect([...panes.keys()]).toEqual(Array.from({ length: counts[layout] }, (_, i) => i + 1));
    expect(dividers).toHaveLength(counts[layout] - 1);
    for (const [id, rect] of panes) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(dimensions.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(dimensions.height);
      for (const [otherId, other] of panes) {
        if (id === otherId) continue;
        expect(rect.x + rect.width <= other.x || other.x + other.width <= rect.x
          || rect.y + rect.height <= other.y || other.y + other.height <= rect.y).toBe(true);
      }
    }
  });

  it("constrains a dragged split and reuses its ratio after a temporary fallback or maximize", () => {
    const ratios = { leftFour: { root: .9 } };
    const regular = paneLayout("leftFour", dimensions, ratios, null);
    expect(regular.panes.get(2)!.width).toBeGreaterThanOrEqual(210);
    expect([...paneLayout("leftFour", { width: 500, height: 600 }, ratios, 4).panes.keys()]).toEqual([1]);
    expect([...paneLayout("leftFour", dimensions, ratios, 4).panes.keys()]).toEqual([4]);
    expect(paneLayout("leftFour", dimensions, ratios, null)).toEqual(regular);
  });

  it("fills missing or illegal secondary periods while retaining valid stored choices", () => {
    expect(secondaryIntervals(60, 300, [900, 60, 300, 3600, 15], [null, 900, 65, 900])).toEqual([60, 900, 3600, 900]);
    expect(secondaryIntervals(300, 300, [60, 300], [])).toEqual([300, 300, 300, 300]);
  });
});
