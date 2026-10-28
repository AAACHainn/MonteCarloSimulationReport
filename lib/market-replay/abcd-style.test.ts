import { describe, expect, it } from "vitest";
import { DEFAULT_ABCD_STYLE } from "./chart-drawings";
import { abcdSettingsStyle } from "./abcd-style";

describe("AB=CD settings style", () => {
  it("normalizes edited styles to fixed, enabled C and D lines in one color", () => {
    const original = {
      ...DEFAULT_ABCD_STYLE,
      singleColor: "#123456",
      width: 3 as const,
      lineStyle: "DASHED" as const,
      showPrices: true,
      showLevels: true,
      levels: [
        { value: 0, enabled: false, color: "#FF0000" },
        { value: 1, enabled: false, color: "#00FF00" },
        { value: 0.618, enabled: true, color: "#0000FF" },
      ],
    };

    const result = abcdSettingsStyle(original);

    expect(result).toEqual({
      ...original,
      levels: [
        { value: 0, enabled: true, color: "#123456" },
        { value: 1, enabled: true, color: "#123456" },
      ],
    });
    expect(original.levels).toHaveLength(3);
  });

  it("chooses an existing C/D color when the unified color is unset", () => {
    const result = abcdSettingsStyle({
      ...DEFAULT_ABCD_STYLE,
      singleColor: null,
      levels: [
        { value: 0, enabled: true, color: "#AAAAAA" },
        { value: 1, enabled: true, color: "#BBBBBB" },
        { value: 0.5, enabled: true, color: "#CCCCCC" },
      ],
    });
    expect(result.singleColor).toBe("#BBBBBB");
    expect(result.levels).toEqual([
      { value: 0, enabled: true, color: "#BBBBBB" },
      { value: 1, enabled: true, color: "#BBBBBB" },
    ]);
  });

  it("keeps a legacy style unchanged until explicitly normalized", () => {
    const legacy = { ...DEFAULT_ABCD_STYLE, singleColor: null,
      levels: [{ value: 0, enabled: false, color: "#111111" }, { value: 0.5, enabled: true, color: "#222222" }, { value: 1, enabled: false, color: "#333333" }] };
    expect(legacy.levels).toHaveLength(3);
    expect(abcdSettingsStyle(legacy).levels).toEqual([
      { value: 0, enabled: true, color: "#333333" },
      { value: 1, enabled: true, color: "#333333" },
    ]);
  });
});
