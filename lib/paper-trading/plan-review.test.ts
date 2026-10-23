import { describe, expect, it } from "vitest";
import { reviewLength, MAX_REVIEW_LENGTH } from "./review-templates";
import { initialPlanReview } from "./plan-review";

describe("initial trading plan review", () => {
  it("copies the pre-entry classification and plan into the six-part review", () => {
    const review = initialPlanReview({ mode: "PLAN", context: "NARROW_RANGE", plan: "等待突破失败。",
      displayIntervalSeconds: 300, confirmedSequence: 10, confirmedAt: "2026-10-23T00:00:00.000Z" });
    expect(review).toContain("窄交易区间 TTR");
    expect(review).toContain("做单级别：5m");
    expect(review).toContain("下单前交易计划：等待突破失败。");
    expect(review).toContain("6、下一步（只写一项）");
  });

  it("leaves room for later notes even with the longest allowed plan", () => {
    const review = initialPlanReview({ mode: "PLAN", context: "STRONG_BREAKOUT", plan: "价".repeat(800),
      displayIntervalSeconds: 60, confirmedSequence: 10, confirmedAt: "2026-10-23T00:00:00.000Z" });
    expect(reviewLength(review)).toBeLessThan(MAX_REVIEW_LENGTH);
  });
});
