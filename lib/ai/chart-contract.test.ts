import { describe, expect, it } from "vitest";
import { chartPreferencesSchema, defaultChartPreferences } from "./chart-contract";
import { DEFAULT_BAR_COUNT_CONFIG } from "@/lib/market-replay/bar-count";

describe("Bar Count screenshot preference contract", () => {
  it("keeps the custom RTH boundary color in a new request", () => {
    const preferences = defaultChartPreferences(0);
    preferences.barCountConfig.rthBoundaryColor = "#123ABC";
    expect(chartPreferencesSchema.parse(preferences).barCountConfig.rthBoundaryColor).toBe("#123ABC");
  });
  it("accepts an old client while only defaulting the newly added color", () => {
    const preferences = defaultChartPreferences(0);
    const oldConfig: Partial<typeof preferences.barCountConfig> = { ...preferences.barCountConfig };
    delete oldConfig.rthBoundaryColor;
    const oldRequest = { ...preferences, barCountConfig: { ...oldConfig, regularColor: "#123456" } };
    const frozen = structuredClone(oldRequest);
    expect(chartPreferencesSchema.parse(oldRequest).barCountConfig).toEqual({
      ...oldRequest.barCountConfig, rthBoundaryColor: DEFAULT_BAR_COUNT_CONFIG.rthBoundaryColor,
    });
    expect(oldRequest).toEqual(frozen);
  });
  it("rejects invalid colors and unknown fields", () => {
    const preferences = defaultChartPreferences(0);
    expect(chartPreferencesSchema.safeParse({ ...preferences, barCountConfig: { ...preferences.barCountConfig, rthBoundaryColor: "red" } }).success).toBe(false);
    expect(chartPreferencesSchema.safeParse({ ...preferences, barCountConfig: { ...preferences.barCountConfig, unknownColor: "#FFFFFF" } }).success).toBe(false);
  });
});
