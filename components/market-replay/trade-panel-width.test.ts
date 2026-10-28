import { describe, expect, it } from "vitest";
import { clampTradePanelWidth, parseTradePanelWidth, tradePanelMaximum } from "./trade-panel-width";

describe("trade panel width", () => {
  it("uses a safe default for missing or invalid browser preferences and clamps saved values", () => {
    expect(parseTradePanelWidth(null)).toBe(360);
    expect(parseTradePanelWidth(" ")).toBe(360);
    expect(parseTradePanelWidth("NaN")).toBe(360);
    expect(parseTradePanelWidth("250")).toBe(320);
    expect(parseTradePanelWidth("450")).toBe(450);
    expect(parseTradePanelWidth("900")).toBe(640);
  });

  it("keeps space for the chart and restores the preferred width when space returns", () => {
    const preferred = 600;
    expect(tradePanelMaximum(1024)).toBe(496);
    expect(clampTradePanelWidth(preferred, tradePanelMaximum(1024))).toBe(496);
    expect(clampTradePanelWidth(preferred, tradePanelMaximum(1440))).toBe(preferred);
    expect(tradePanelMaximum(1920)).toBe(640);
    expect(tradePanelMaximum(700)).toBe(320);
  });
});
