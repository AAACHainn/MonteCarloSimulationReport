import { describe, expect, it } from "vitest";
import { emptyGrowthTotals, foundationReady, FOUNDATION_REQUIREMENTS, growthRealm, growthSegment, receivedUsdtMinor, reviewEarnsFirstCompletion } from "./rules";
import { settledGrowthNotice } from "./presentation";
describe("versioned growth rules", () => {
  it.each([[0,0],[99,0],[100,1],[399,1],[400,2],[849,2],[850,3],[13599,11],[13600,12],[18099,12],[18100,12],[999999,12]])("derives experience %i as layer %i without spending experience", (xp, layer) => {
    expect(growthRealm(xp).layer).toBe(layer); expect(growthRealm(xp).realm).toBe(layer ? "QI" : "MORTAL");
  });
  it("uses layer intervals and keeps surplus at layer twelve", () => {
    expect(growthSegment(99)).toMatchObject({ value: 99, max: 100 });
    expect(growthSegment(100)).toMatchObject({ value: 0, max: 300 });
    expect(growthSegment(16500)).toMatchObject({ value: 2900, max: 4500 });
    expect(growthSegment(19300)).toMatchObject({ value: 5700, max: 4500 });
    expect(growthRealm(21100, true)).toEqual({ realm: "FOUNDATION", layer: 1 });
    expect(growthSegment(21100, true)).toBeUndefined();
  });
  it("requires every exact threshold without any calendar or template condition", () => {
    expect(foundationReady(emptyGrowthTotals())).toBe(false);
    expect(foundationReady({ ...FOUNDATION_REQUIREMENTS })).toBe(true);
    for (const key of Object.keys(FOUNDATION_REQUIREMENTS) as Array<keyof typeof FOUNDATION_REQUIREMENTS>) {
      const value = FOUNDATION_REQUIREMENTS[key];
      expect(foundationReady({ ...FOUNDATION_REQUIREMENTS, [key]: typeof value === "bigint" ? value - BigInt(1) : value - 1 })).toBe(false);
    }
  });
  it("accumulates received money in integer cents without rounding up a shortfall", () => {
    expect(receivedUsdtMinor(0.29) + receivedUsdtMinor(99999.71)).toBe(BigInt(10_000_000));
    expect(receivedUsdtMinor(99999.99)).toBe(BigInt(9_999_999));
    expect(() => receivedUsdtMinor(99999.995)).toThrow();
    expect(() => receivedUsdtMinor(-1)).toThrow(); expect(() => receivedUsdtMinor(NaN)).toThrow();
  });
  it("requires changed nonempty review or a verified explicit AI adoption", () => {
    expect(reviewEarnsFirstCompletion("自动预填", "自动预填")).toBe(false);
    expect(reviewEarnsFirstCompletion("自动预填", " 自动预填 \n")).toBe(false);
    expect(reviewEarnsFirstCompletion("", "  \n ")).toBe(false);
    expect(reviewEarnsFirstCompletion("自动预填", "实际复盘")).toBe(true);
    expect(reviewEarnsFirstCompletion("相同草稿", "相同草稿", true)).toBe(true);
  });
  it("does not replay initial, stale or speculative growth feedback and names the actual owner", () => {
    const before = { userId: "owner-a", nickname: "甲", totalXp: 95, realmLabel: "凡人", version: 2 };
    const after = { ...before, totalXp: 100, realmLabel: "炼气一层", version: 3 };
    expect(settledGrowthNotice(null, after)).toBeNull(); expect(settledGrowthNotice(before, before)).toBeNull();
    expect(settledGrowthNotice(after, before)).toBeNull(); expect(settledGrowthNotice(before, { ...after, userId: "other" })).toBeNull();
    expect(settledGrowthNotice(before, after)).toContain("甲"); expect(settledGrowthNotice(before, after)).toContain("+5");
    expect(settledGrowthNotice(before, after)).toContain("炼气一层");
  });
});
