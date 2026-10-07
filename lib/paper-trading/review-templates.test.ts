import { describe, expect, it } from "vitest";
import { limitReview, normalizeReviewTemplateKey, reviewLength } from "./review-templates";

describe("review template content compatibility", () => {
  it("preserves whitespace and newlines when applying review limits", () => {
    const content = "入场依据：\n  - 趋势\n执行情况：\n";
    expect(limitReview(content)).toBe(content);
  });
  it("does not split an emoji at the three-hundred-character limit", () => {
    expect(reviewLength("😀".repeat(300))).toBe(300);
    expect(limitReview("😀".repeat(301))).toBe("😀".repeat(300));
  });
  it("treats equivalent full-width and case variations as the same template name", () => {
    expect(normalizeReviewTemplateKey(" Ｒeview ")).toBe(normalizeReviewTemplateKey("review"));
  });
});
