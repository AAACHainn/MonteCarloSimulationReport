import { describe, expect, it } from "vitest";
import { aiLimitsSchema, DEFAULT_LIMITS, limitFields, resolveLimits } from "./limits";
import { budgetView } from "./budget";

describe("AI configurable limits and reported usage", () => {
  it("keeps previous defaults for existing settings and snapshots", () => {
    expect(resolveLimits()).toEqual(DEFAULT_LIMITS);
    const value = budgetView({ task: "globalAssistant", calls: 1, usage: '[{"input":10,"output":5}]', snapshot: '{}' }, 0);
    expect(value).toMatchObject({ legacy: true, totalTokens: 15, limits: DEFAULT_LIMITS });
  });
  it.each(Object.keys(limitFields) as Array<keyof typeof limitFields>)("rejects invalid %s values", (key) => {
    for (const value of [limitFields[key].min - 1, limitFields[key].max + 1, 1234.5, NaN, Infinity, null, "4096"])
      expect(aiLimitsSchema.safeParse({ [key]: value }).success).toBe(false);
  });
  it("validates resource reservations and merges temporary values without mutating defaults", () => {
    expect(resolveLimits({ outputTokens: 8192 }, { inputChars: 96000 })).toMatchObject({ outputTokens: 8192, inputChars: 96000 });
    expect(aiLimitsSchema.safeParse({ inputChars: 500000 }).success).toBe(false);
    expect(aiLimitsSchema.safeParse({ maxModelCalls: 64, maxAnalysisCalls: 20 }).success).toBe(false);
    expect(aiLimitsSchema.safeParse({ modelSeconds: 600, runSeconds: 300 }).success).toBe(false);
    expect(aiLimitsSchema.safeParse({ unknown: 123 }).success).toBe(false);
    expect(DEFAULT_LIMITS.outputTokens).toBe(4096);
  });
  it("counts routing and tool rounds as cumulative usage, without confusing their total with one output cap", () => {
    const value = budgetView({ task: "globalAssistant", calls: 1, usage: '[{"input":2014,"output":131},{"input":5634,"output":759}]',
      snapshot: JSON.stringify({ limits: resolveLimits(), routing: {}, estimatedChars: 16372, budgetExceeded: { resource: "inputChars", used: 51000, limit: 48000 } }) }, 1);
    expect(value).toMatchObject({ modelCalls: 2, toolCalls: 1, inputTokens: 7648, outputTokens: 890, totalTokens: 8538,
      unreportedCalls: 0, lastUsage: { input: 5634, output: 759 }, blocked: { resource: "inputChars" } });
  });
  it("keeps absent or partly reported usage unknown and does not charge reused routing", () => {
    const value = budgetView({ task: "sessionReview", calls: 2, usage: '[{"input":100,"output":null}]', snapshot: '{"routing":{"reused":true}}' }, 0);
    expect(value).toMatchObject({ modelCalls: 2, totalTokens: null, inputTokens: 100, unreportedCalls: 2, inputReported: true, outputReported: false });
    expect(budgetView({ task: "globalAssistant", calls: 1, usage: '[]', snapshot: '{}' }, 0)).toMatchObject({ totalTokens: null, unreportedCalls: 1, lastUsage: null, inputReported: false });
    expect(budgetView({ task: "globalAssistant", calls: 1, usage: '[{"input":0,"output":0}]', snapshot: '{}' }, 0).totalTokens).toBe(0);
  });
});
