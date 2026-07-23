import { describe, expect, it } from "vitest";
import {
  deduplicateTagNames,
  matchesAnyTag,
  normalizeTagKey,
  normalizeTagName,
} from "@/lib/trade-journal/tags";
import { tradeTagSchema, tradeTagsReplaceSchema } from "@/lib/validations";

describe("trade tags", () => {
  it("normalizes Unicode and surrounding whitespace", () => {
    expect(normalizeTagName("  Ａ级机会  ")).toBe("A级机会");
    expect(normalizeTagKey("  BreakOut ")).toBe("breakout");
  });

  it("deduplicates names case-insensitively while preserving the first display name", () => {
    expect(deduplicateTagNames([" BreakOut ", "breakout", "回调", " 回调 "])).toEqual(["BreakOut", "回调"]);
  });

  it("matches a trade when it contains any selected tag", () => {
    const tags = [{ id: "breakout", name: "突破" }, { id: "winner", name: "盈利" }];

    expect(matchesAnyTag(tags, [])).toBe(true);
    expect(matchesAnyTag(tags, ["winner", "loss"])).toBe(true);
    expect(matchesAnyTag(tags, ["loss"])).toBe(false);
  });

  it("validates tag length and the per-trade tag limit", () => {
    expect(tradeTagSchema.safeParse({ name: "x".repeat(51) }).success).toBe(false);
    expect(
      tradeTagsReplaceSchema.safeParse({
        tags: Array.from({ length: 21 }, (_, index) => `标签${index}`),
      }).success,
    ).toBe(false);
  });
});
