import { describe, expect, it } from "vitest";
import { explainPayout } from "./payout-explanation";
import { currentStage, defaultPropRules, initialPropState, payoutPreview, type PropRules, type PropState } from "./rules";

function funded(profit = 2020) {
  const rules = structuredClone(defaultPropRules);
  const state = initialPropState(rules, 0);
  state.phase = "FUNDED"; currentStage(state).kind = "FUNDED";
  currentStage(state).trailingFloor = 50020;
  state.last = { sequence: 10, day: "2026-09-11", rawNet: profit, unrealized: 0, flat: true, pending: 0, hadFill: true };
  return { rules, state };
}
function increased(state: PropState, additionalNetProfit: number): PropState {
  return { ...state, last: { ...state.last!, rawNet: state.last!.rawNet + additionalNetProfit } };
}
function expectSmallestGap(rules: PropRules, state: PropState) {
  const gap = explainPayout(rules, state).gap;
  expect(gap).not.toBeNull();
  expect(payoutPreview(rules, increased(state, gap!.additionalNetProfit)).maximum).toBeGreaterThanOrEqual(rules.payout.minimum);
  expect(payoutPreview(rules, increased(state, gap!.additionalNetProfit - 0.01)).maximum).toBeLessThan(rules.payout.minimum);
  return gap!;
}

describe("payout explanations reuse the authoritative amount preview", () => {
  it("explains the screenshot's retained-profit buffer and includes the minimum payout in the 580 gap", () => {
    const { rules, state } = funded();
    const original = structuredClone({ rules, state });
    const result = explainPayout(rules, state);
    expect(result.reasons).toEqual(["buffer"]);
    expect(result.limits.find(limit => limit.key === "buffer")).toEqual({ key: "buffer", value: -80, blocking: true });
    expect(result.limits.filter(limit => limit.blocking)).toHaveLength(1);
    expect(expectSmallestGap(rules, state)).toEqual({ additionalNetProfit: 580, requiredBalance: 52600, retainedBalance: 52100 });
    expect(payoutPreview(rules, increased(state, 80)).maximum).toBe(0);
    expect({ rules, state }).toEqual(original);
  });

  it("combines all monetary restrictions rather than reporting only the smallest current limit", () => {
    const { rules, state } = funded(100);
    expect(explainPayout(rules, state).reasons).toEqual(["fraction", "buffer", "risk"]);
    expect(expectSmallestGap(rules, state).additionalNetProfit).toBe(2500);
  });

  it("includes prior payouts and a negative remaining-profit balance when explaining the fraction limit", () => {
    const { rules, state } = funded(-100);
    rules.payout.buffer = null; currentStage(state).trailingFloor = 48000;
    currentStage(state).grossPayout = 400;
    expect(explainPayout(rules, state).reasons).toEqual(["fraction"]);
    expect(expectSmallestGap(rules, state).additionalNetProfit).toBe(1500);
    expect(explainPayout(rules, state).gap?.retainedBalance).toBeNull();
  });

  it("uses the post-withdrawal permanent floor and its strict safety cent", () => {
    const { rules, state } = funded(1000);
    rules.payout.buffer = null; rules.payout.fraction = 1; rules.payout.permanentFloorOffset = 1000;
    expect(explainPayout(rules, state).reasons).toEqual(["risk"]);
    expect(expectSmallestGap(rules, state).additionalNetProfit).toBe(500.01);
  });

  it.each([0.01, 0.29, 1.13, 4.11])("does not add a spurious cent to a valid %s gap", amount => {
    const { rules, state } = funded(0);
    rules.payout.minimum = amount; rules.payout.buffer = null; rules.payout.fraction = 1;
    currentStage(state).trailingFloor = 48000;
    expect(expectSmallestGap(rules, state).additionalNetProfit).toBe(amount);
  });

  it("does not round a genuine sub-cent shortfall into already meeting the minimum", () => {
    const { rules, state } = funded(0.5799999999);
    rules.payout.minimum = 0.29; rules.payout.buffer = null; currentStage(state).trailingFloor = 48000;
    expect(payoutPreview(rules, state).maximum).toBe(0.28);
    expect(expectSmallestGap(rules, state).additionalNetProfit).toBe(0.01);
  });

  it("keeps amount readiness separate from day, position and order requirements", () => {
    const { rules, state } = funded(5000);
    rules.funded.qualifyingDays = 2; rules.funded.qualifyingProfit = 100;
    state.last!.flat = false; state.last!.pending = 1;
    expect(explainPayout(rules, state)).toMatchObject({ reasons: ["positions", "orders", "qualifyingDays"], gap: null });
    state.last!.flat = true; state.last!.pending = 0;
    currentStage(state).days = [0, 1].map(i => ({ day: "day" + i, startRawNet: i * 1000, endRawNet: (i + 1) * 1000,
      balance: 51000 + i * 1000, traded: true, settled: true }));
    expect(explainPayout(rules, state).reasons).toEqual([]);
    expect(payoutPreview(rules, state).eligible).toBe(true);
    state.pause = "DATA_END";
    expect(explainPayout(rules, state).reasons).toEqual([]);
  });

  it.each(["STAGE_WAIT", "PAYOUT_DAY", "BOUNDARY"] as const)("explains the %s pause without claiming eligibility", pause => {
    const { rules, state } = funded(5000); state.pause = pause;
    expect(explainPayout(rules, state)).toMatchObject({ reasons: [pause], gap: null });
  });

  it.each(["FAILED", "STOPPED"] as const)("does not estimate future profits for a %s account", result => {
    const { rules, state } = funded(); state.result = result;
    expect(explainPayout(rules, state).gap).toBeNull();
    expect(explainPayout(rules, state).reasons).toContain(result === "FAILED" ? "failed" : "stopped");
  });

  it("does not estimate unobserved accounts or an evaluation stage", () => {
    const { rules, state } = funded(); state.last = null;
    expect(explainPayout(rules, state)).toMatchObject({ reasons: expect.arrayContaining(["observation"]), gap: null });
    const evaluation = initialPropState(rules, 0);
    expect(explainPayout(rules, evaluation)).toMatchObject({ reasons: expect.arrayContaining(["phase"]), gap: null });
  });

  it("does not promise extra profits will fix a fixed cap below the minimum", () => {
    const { rules, state } = funded(5000); rules.payout.maximum = 499;
    expect(explainPayout(rules, state)).toMatchObject({ reasons: ["maximum"], gap: null });
  });

  it("bounds extreme fraction estimates without displaying infinity or freezing the UI", () => {
    const { rules, state } = funded(); rules.payout.fraction = Number.MIN_VALUE;
    expect(explainPayout(rules, state).gap).toBeNull();
    expect(explainPayout(rules, state).reasons).toContain("fraction");
  });
});
