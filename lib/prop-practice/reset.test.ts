import { describe, expect, it } from "vitest";
import { defaultPropRules, initialPropState, resetPropState, type PropState } from "./rules";
describe("restart failed prop rounds", () => {
  it.each(["EVALUATION", "FUNDED"] as const)("always creates an independent evaluation after %s failure", phase => {
    const previous: PropState = { ...initialPropState(defaultPropRules, 0), phase, result: "FAILED", totalReceived: 900, totalRequested: 1000, payoutCount: 1,
      last: { sequence: 10, day: "2026-10-01", rawNet: -2000, unrealized: -500, flat: false, pending: 2, hadFill: true } };
    const frozen = structuredClone(previous), next = resetPropState(defaultPropRules, previous, 11);
    expect(next).toEqual(initialPropState(defaultPropRules, 11));
    expect(next.phase).toBe("EVALUATION"); expect(next.payoutCount).toBe(0); expect(next.totalReceived).toBe(0);
    expect(previous).toEqual(frozen); expect(next.stages[0]).not.toBe(previous.stages[0]);
  });
  it.each([null, "STOPPED"] as const)("does not restart result %s", result => {
    expect(() => resetPropState(defaultPropRules, { ...initialPropState(defaultPropRules, 0), result }, 1)).toThrow();
  });
  it("never replays or skips backwards past the failed source candle", () => {
    const previous: PropState = { ...initialPropState(defaultPropRules, 0), result: "FAILED", last: { sequence: 10, day: "2026-10-01", rawNet: 0, unrealized: -2000, flat: false, pending: 2, hadFill: false } };
    for (const sequence of [-1, 9, 10, NaN, Infinity, 10.5]) expect(() => resetPropState(defaultPropRules, previous, sequence)).toThrow();
  });
});
