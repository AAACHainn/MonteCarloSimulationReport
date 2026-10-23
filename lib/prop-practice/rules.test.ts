import { describe, expect, it } from "vitest";
import { applyPayout, currentStage, defaultPropRules, evaluationProgress, funds, initialPropState, observeProp, payoutPreview, preparePropDay, propRulesSchema, settlePropDay, type Observation, type PropRules } from "./rules";
import { propTradingDay } from "./trading-day";
import { propResultLabel } from "./result-label";
import { formatMoney } from "@/lib/format";
const rules = (): PropRules => structuredClone({ ...defaultPropRules, name: "Test" });
const o = (rawNet: number, rest: Partial<Observation> = {}): Observation => ({ sequence: 1, day: "day1", rawNet, unrealized: 0, flat: true, pending: 0, hadFill: true, ...rest });
const monetaryPaths = ["purchaseCost", "activationCost", "evaluation.risk.initialCapital", "evaluation.risk.drawdown", "evaluation.risk.capOffset", "evaluation.target", "evaluation.qualifyingProfit", "funded.risk.initialCapital", "funded.risk.drawdown", "funded.risk.capOffset", "payout.minimum", "payout.maximum", "payout.buffer", "payout.permanentFloorOffset"];
function setAmount(r: PropRules, path: string, amount: number) {
  const keys = path.split("."); let object = r as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) object = object[key] as Record<string, unknown>;
  object[keys.at(-1)!] = amount;
}
describe("prop account pure ledger", () => {
  it.each(monetaryPaths)("validates cents consistently for %s without rounding the saved configuration", path => {
    for (const amount of [0.001, 500.001]) {
      const r = rules(); setAmount(r, path, amount);
      const result = propRulesSchema.safeParse(r); expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(i => i.path.join(".") === path)).toBe(true);
    }
    const r = rules(); r.payout.minimum = 0.01; setAmount(r, path, 0.29);
    expect(propRulesSchema.parse(r)).toEqual(r);
  });
  it("keeps negative offsets precise and retains independent percentage and original capital ranges", () => {
    const r = rules(); r.evaluation.risk.capOffset = -0.01; r.funded.risk.capOffset = -0.01; r.payout.permanentFloorOffset = -0.01;
    r.evaluation.risk.initialCapital = 999999999999.99; r.evaluation.consistency = 0.3333; r.payout.fraction = 0.1234; r.payout.traderShare = 0.9999;
    expect(propRulesSchema.parse(r)).toEqual(r);
    for (const path of ["evaluation.risk.capOffset", "funded.risk.capOffset", "payout.permanentFloorOffset"]) { const invalid = structuredClone(r); setAmount(invalid, path, -0.001); expect(propRulesSchema.safeParse(invalid).success).toBe(false); }
  });
  it("rejects a sub-cent payout interval that cannot contain a valid application", () => {
    const r = rules(); r.payout.minimum = 500.001; r.payout.maximum = 500.001;
    const result = propRulesSchema.safeParse(r);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(i => i.path.join("."))).toEqual(expect.arrayContaining(["payout.minimum", "payout.maximum"]));
    r.payout.minimum = 500.01; r.payout.maximum = 500;
    expect(propRulesSchema.safeParse(r).success).toBe(false);
  });
  it.each([0.01, 0.29, 1.13, 500.01])("can actually withdraw the valid single-cent interval %s", amount => {
    const r = rules(); r.evaluation.minTradingDays = null; r.evaluation.consistency = null;
    r.payout = { ...r.payout, minimum: amount, maximum: amount, buffer: null, fraction: 1, traderShare: 1 };
    expect(propRulesSchema.safeParse(r).success).toBe(true);
    let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000)));
    s = observeProp(r, preparePropDay(r, s, "day2").state, o(13000, { day: "day2", sequence: 2 }));
    expect(payoutPreview(r, s)).toMatchObject({ maximum: amount, eligible: true });
    expect(applyPayout(r, s, amount).received).toBe(amount);
    expect(() => applyPayout(r, s, amount + 0.001)).toThrow();
  });
  it("still floors a genuinely sub-cent profit limit without rounding raw profit upward", () => {
    const r = rules(); r.evaluation.minTradingDays = null; r.evaluation.consistency = null;
    r.payout = { ...r.payout, minimum: 0.01, maximum: null, fraction: 0.5, buffer: null };
    let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000)));
    s = observeProp(r, preparePropDay(r, s, "day2").state, o(3000.5799999999, { day: "day2", sequence: 2 }));
    expect(payoutPreview(r, s).maximum).toBe(0.28);
    expect(() => applyPayout(r, s, 0.29)).toThrow();
  });
  it.each([undefined, null, 0, 100])("preserves optional activation cost %s without changing any computation", activationCost => {
    const r = rules(); r.activationCost = activationCost;
    expect(propRulesSchema.parse(r).activationCost).toBe(activationCost);
    expect(observeProp(r, initialPropState(r, 0), o(100))).toEqual(observeProp(rules(), initialPropState(rules(), 0), o(100)));
  });
  it("rejects deleted rules, invalid bounds and cost precision", () => {
    for (const mode of ["SOURCE_EQUITY", "DAILY_LOSS"]) { const r = rules(); Object.assign(r.evaluation.risk, { mode }); expect(propRulesSchema.safeParse(r).success).toBe(false); }
    const extra = rules(); Object.assign(extra.funded, { minTradingDays: 2 }); expect(propRulesSchema.safeParse(extra).success).toBe(false);
    const r = rules();
    r.purchaseCost = -1; expect(propRulesSchema.safeParse(r).success).toBe(false);
    r.purchaseCost = 1.001; expect(propRulesSchema.safeParse(r).success).toBe(false);
    r.purchaseCost = 0; r.evaluation.risk.capOffset = -2001; expect(propRulesSchema.safeParse(r).success).toBe(false);
    r.evaluation.risk.capOffset = -2000; expect(propRulesSchema.safeParse(r).success).toBe(true);
  });
  it("checks strict unrounded equity against static floor after the complete snapshot", () => {
    const r = rules(); r.evaluation.risk.mode = "STATIC";
    expect(observeProp(r, initialPropState(r, 0), o(-1999.999)).result).toBeNull();
    const s = observeProp(r, initialPropState(r, 0), o(-2000.00001, { flat: false, pending: 2 }));
    expect(s.result).toBe("FAILED"); expect(s.failure?.equity).toBeLessThan(48000);
  });
  it("raises EOD floor once, never intraday or from raw peak equity", () => {
    const r = rules(); r.evaluation.target = 1e8;
    let s = observeProp(r, initialPropState(r, 0), o(3000, { unrealized: 20000 }));
    expect(funds(s).floor).toBe(48000);
    s = settlePropDay(r, s); expect(funds(s).floor).toBe(50000);
    expect(settlePropDay(r, s)).toEqual(s);
    s = observeProp(r, preparePropDay(r, s, "day2").state, o(1000, { sequence: 2, day: "day2" }));
    expect(funds(s).floor).toBe(50000); expect(settlePropDay(r, s).result).toBeNull();
  });
  it("risk has priority over passing after a new EOD floor", () => {
    const r = rules(); r.evaluation.risk.capOffset = null; r.evaluation.minTradingDays = null; r.evaluation.consistency = null;
    const s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000, { unrealized: -2000, flat: false })));
    expect(s.result).toBe("FAILED"); expect(s.phase).toBe("EVALUATION");
  });
  it("ignores unrealized profit for qualification and needs actual fills", () => {
    const r = rules(); r.evaluation.qualifyingDays = 1; r.evaluation.qualifyingProfit = 1; r.evaluation.minTradingDays = null;
    let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000, { hadFill: false })));
    expect(evaluationProgress(r, s).qualifyingDays).toBe(0); expect(s.phase).toBe("EVALUATION");
    s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(0, { unrealized: 10000, flat: false })));
    expect(evaluationProgress(r, s).net).toBe(0);
  });
  it("keeps consistency unmet at nonpositive net and reports required profit", () => {
    const r = rules(); let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(2000)));
    expect(evaluationProgress(r, s).requiredProfit).toBe(4000);
    s = preparePropDay(r, s, "day2").state; s = settlePropDay(r, observeProp(r, s, o(0, { day: "day2", sequence: 2 })));
    expect(evaluationProgress(r, s).passed).toBe(false);
  });
  it("promotes at EOD with separate capital and anchor while retaining evaluation history", () => {
    const r = rules(); r.evaluation.minTradingDays = null; r.evaluation.consistency = null; r.funded.risk.initialCapital = 25000;
    const original = initialPropState(r, 0); const observed = observeProp(r, original, o(3000));
    const s = settlePropDay(r, observed);
    expect(original.last).toBeNull(); expect(s.stages).toHaveLength(2); expect(s.stages[0].days[0].endRawNet).toBe(3000);
    expect(funds(s).balance).toBe(25000); expect(currentStage(s).anchor).toBe(3000); expect(s.pause).toBe("STAGE_WAIT");
    const next = preparePropDay(r, s, "day2"); expect(next.stop).toBe(false); expect(next.state.pause).toBe("NONE");
    const cross = preparePropDay(r, observed, "day2"); expect(cross.stop).toBe(true); expect(cross.state.phase).toBe("FUNDED");
  });
  it("pending orders prevent passing until explicitly handled", () => {
    const r = rules(); r.evaluation.minTradingDays = null; r.evaluation.consistency = null;
    let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000, { pending: 1 })));
    expect(s.phase).toBe("EVALUATION");
    s = settlePropDay(r, observeProp(r, s, o(3000, { pending: 0, hadFill: false })));
    expect(s.phase).toBe("FUNDED");
  });
  it("deducts gross only once and allows remaining profit next day without new profit", () => {
    const r = rules(); r.evaluation.minTradingDays = null; r.evaluation.consistency = null;
    let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000)));
    s = preparePropDay(r, s, "day2").state; s = observeProp(r, s, o(8000, { day: "day2", sequence: 2 }));
    expect(payoutPreview(r, s).maximum).toBe(2000);
    const result = applyPayout(r, s, 1000); s = result.state;
    expect(result.received).toBe(900); expect(result.share).toBe(100); expect(funds(s).balance).toBe(54000);
    expect(() => applyPayout(r, s, 500)).toThrow();
    s = preparePropDay(r, s, "day3").state; s = observeProp(r, s, o(8000, { day: "day3", sequence: 3, hadFill: false }));
    expect(payoutPreview(r, s).maximum).toBe(1900); expect(payoutPreview(r, s).eligible).toBe(true);
    s.pause = "DATA_END"; expect(payoutPreview(r, s).eligible).toBe(true);
  });
  it("applies permanent floor before quota, keeps strict safety unit and rejects zero-rounded share", () => {
    const r = rules(); r.evaluation.minTradingDays = null; r.evaluation.consistency = null;
    r.payout.buffer = null; r.payout.fraction = 1; r.payout.permanentFloorOffset = 4500;
    let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000)));
    s = observeProp(r, preparePropDay(r, s, "day2").state, o(8000, { day: "day2" }));
    expect(payoutPreview(r, s).maximum).toBe(499.99); expect(payoutPreview(r, s).eligible).toBe(false);
    r.payout.minimum = 0.01; r.payout.traderShare = 0.0001;
    expect(() => applyPayout(r, s, 0.01)).toThrow();
  });
  it("settles the final post-payout EOD balance without changing an already settled high water", () => {
    const r = rules(); r.evaluation.minTradingDays = null; r.evaluation.consistency = null; r.funded.risk.capOffset = null;
    let s = settlePropDay(r, observeProp(r, initialPropState(r, 0), o(3000)));
    s = observeProp(r, preparePropDay(r, s, "day2").state, o(8000, { day: "day2" }));
    const intraday = settlePropDay(r, applyPayout(r, s, 1000).state);
    expect(currentStage(intraday).highWater).toBe(54000);
    const settled = settlePropDay(r, s);
    expect(currentStage(applyPayout(r, settled, 1000).state).highWater).toBe(55000);
  });
  it("keeps failures irreversible and uses outcome labels independently of archive", () => {
    const r = rules(); const s = observeProp(r, initialPropState(r, 0), o(-2000));
    expect(observeProp(r, s, o(10000))).toEqual(s);
    expect(propResultLabel(s, "USD", formatMoney)).toBe("考核未通过");
    s.phase = "FUNDED"; expect(propResultLabel(s, "USD", formatMoney)).toBe("出金失败");
    s.totalReceived = 900; expect(propResultLabel(s, "USD", formatMoney)).toContain("900");
  });
});
describe("source trading days", () => {
  it("uses source timezone for 24/7 days and rejects candles crossing a boundary", () => {
    const calendar = { sourceSeconds: 60, session: { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "Asia/Shanghai", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] } };
    expect(propTradingDay("2026-10-01T15:59:00Z", calendar)?.eod).toBe(true);
    expect(propTradingDay("2026-10-01T16:00:00Z", calendar)?.day).toBe("2026-10-01T16:00:00.000Z");
    expect(propTradingDay("2026-10-01T15:59:30Z", calendar)).toBeNull();
    expect(propTradingDay("2026-10-01T15:59:00Z", { ...calendar, session: { ...calendar.session, timezone: "UNKNOWN" } })).toBeNull();
  });
  it("reuses overnight bounds through daylight saving changes", () => {
    const calendar = { sourceSeconds: 60, session: { mode: "OVERNIGHT_SESSION" as const, timezone: "America/Chicago", openMinute: 1020, closeMinute: 960, weekdays: [1,2,3,4,5] } };
    expect(propTradingDay("2026-10-30T20:59:00Z", calendar)?.eod).toBe(true);
    expect(propTradingDay("2026-11-02T21:59:00Z", calendar)?.eod).toBe(true);
    expect(propTradingDay("2026-11-02T22:00:00Z", calendar)).toBeNull();
  });
});
