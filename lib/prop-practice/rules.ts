import { z } from "zod";
import { initialStageMetrics, observeStageMetrics, type StageMetrics } from "./stage-metrics";
import { copy } from "@/lib/i18n";
import { paperSessionSchema } from "@/lib/validations";

// Validate declared money without rounding it. Raw engine P&L and risk snapshots
// deliberately keep their original precision.
export function hasMoneyPrecision(value: number) {
  return Number.isFinite(value) && Number(value.toFixed(2)) === value;
}
const preciseMoney = (schema: z.ZodNumber) => schema.refine(hasMoneyPrecision, copy.propPractice.invalidMoneyPrecision);
const money = preciseMoney(z.number().finite().min(0).max(1e9));
const positive = preciseMoney(z.number().finite().positive().max(1e9));
const signedMoney = preciseMoney(z.number().finite().min(-1e9).max(1e9));
const optionalMoney = money.nullable().optional();
const count = z.number().int().min(1).max(10000).nullable();
const ratio = z.number().finite().gt(0).max(1);
const risk = z.object({
  initialCapital: paperSessionSchema.shape.initialCapital.refine(hasMoneyPrecision, copy.propPractice.invalidMoneyPrecision),
  drawdown: positive,
  mode: z.enum(["STATIC", "EOD_BALANCE"]),
  capOffset: signedMoney.nullable(),
}).strict().superRefine((r, ctx) => {
  if (r.mode === "EOD_BALANCE" && r.capOffset !== null && r.capOffset < -r.drawdown) ctx.addIssue({ code: "custom", message: copy.propPractice.invalidCap, path: ["capOffset"] });
});
export const propRulesSchema = z.object({
  schemaVersion: z.literal(2),
  name: z.string().trim().min(1).max(100), description: z.string().trim().max(2000),
  purchaseCost: optionalMoney, activationCost: optionalMoney,
  evaluation: z.object({ risk, target: positive, minTradingDays: count, consistency: ratio.nullable() }).strict(),
  funded: z.object({ risk, qualifyingDays: count, qualifyingProfit: positive.nullable() }).strict().superRefine((r, ctx) => {
    if (r.qualifyingDays !== null && r.qualifyingProfit === null) ctx.addIssue({ code: "custom", message: copy.propPractice.invalidRules, path: ["qualifyingProfit"] });
  }),
  payout: z.object({ minimum: positive, fraction: ratio, maximum: positive.nullable(), buffer: money.nullable(),
    traderShare: ratio, permanentFloorOffset: signedMoney.nullable(),
  }).strict().superRefine((r, ctx) => {
    if (r.maximum !== null && r.minimum > r.maximum) ctx.addIssue({ code: "custom", message: copy.propPractice.invalidMinimum, path: ["minimum"] });
  }),
}).strict();
export type PropRules = z.infer<typeof propRulesSchema>;
export type RiskRules = PropRules["funded"]["risk"];
export const defaultPropRules: PropRules = {
  schemaVersion: 2, name: "", description: "", purchaseCost: null, activationCost: null,
  evaluation: { risk: { initialCapital: 50000, drawdown: 2000, mode: "EOD_BALANCE", capOffset: 0 }, target: 3000,
    minTradingDays: 2, consistency: 0.5 },
  funded: { risk: { initialCapital: 50000, drawdown: 2000, mode: "EOD_BALANCE", capOffset: 100 }, qualifyingDays: null, qualifyingProfit: null },
  payout: { minimum: 500, fraction: 0.5, maximum: 2000, buffer: 2100, traderShare: 0.9, permanentFloorOffset: null },
};

export type Observation = { sequence: number; day: string; rawNet: number; unrealized: number; flat: boolean; pending: number; hadFill: boolean; realizedPnl?: number; totalFees?: number };
export type PropDay = { day: string; startRawNet: number; endRawNet: number; balance: number; traded: boolean; settled: boolean; stageEnded?: boolean };
export type PropStage = { kind: "EVALUATION" | "FUNDED"; initialCapital: number; anchor: number; highWater: number;
  trailingFloor: number; permanentFloor: number | null; grossPayout: number; qualifyingAfterDay: string | null;
  days: PropDay[]; startSequence: number; endSequence: number | null; metrics?: StageMetrics };
export type PropState = { stages: PropStage[]; phase: "EVALUATION" | "FUNDED"; pause: "NONE" | "STAGE_WAIT" | "PAYOUT_DAY" | "BOUNDARY" | "DATA_END";
  pausedDay: string | null; totalRequested: number; totalReceived: number; payoutCount: number;
  result: "FAILED" | "STOPPED" | null; failure: { sequence: number; equity: number; floor: number; phase: string } | null;
  last: Observation | null };
/** A payout-day trading restriction must not repeatedly stop market playback. */
export function shouldStopPropReplay(state: PropState) {
  return !!state.result || !["NONE", "PAYOUT_DAY"].includes(state.pause);
}
/** Shared by draft entry and the authoritative order API. */
export function propTradingBlockReason(state: PropState): string | null {
  const t = copy.propPractice;
  if (state.result === "FAILED") return t.failedOrderBlocked;
  if (state.result === "STOPPED") return t.stoppedOrderBlocked;
  switch (state.pause) {
    case "PAYOUT_DAY": return t.payoutDayOrderBlocked;
    case "STAGE_WAIT": return t.stageWaitOrderBlocked;
    case "BOUNDARY": return t.boundaryOrderBlocked;
    default: return null;
  }
}
// Closed days and finished stages are immutable; copy only the current writable tail.
function copyState(before: PropState): PropState {
  const stages = [...before.stages], stage = stages[stages.length - 1], days = [...stage.days];
  if (days.length) days[days.length - 1] = { ...days[days.length - 1] };
  stages[stages.length - 1] = { ...stage, days };
  return { ...before, stages };
}
export function currentStage(s: PropState) { return s.stages[s.stages.length - 1]; }
export function stageRules(r: PropRules, s: PropState) { return s.phase === "EVALUATION" ? r.evaluation.risk : r.funded.risk; }
function newStage(kind: PropStage["kind"], r: RiskRules, anchor: number, sequence: number, observation?: Observation): PropStage {
  return { kind, initialCapital: r.initialCapital, anchor, highWater: r.initialCapital, trailingFloor: r.initialCapital - r.drawdown,
    permanentFloor: null, grossPayout: 0, qualifyingAfterDay: null, days: [], startSequence: sequence, endSequence: null,
    metrics: initialStageMetrics(r.initialCapital, observation?.realizedPnl ?? anchor + (observation?.totalFees ?? 0), observation?.totalFees ?? 0) };
}
export function initialPropState(r: PropRules, sequence: number): PropState {
  return { stages: [newStage("EVALUATION", r.evaluation.risk, 0, sequence)], phase: "EVALUATION", pause: "NONE", pausedDay: null,
    totalRequested: 0, totalReceived: 0, payoutCount: 0, result: null, failure: null, last: null };
}
/** A failed funded round also restarts at evaluation; prior history is never mutated. */
export function resetPropState(rules: PropRules, previous: PropState, nextSequence: number) {
  if (previous.result !== "FAILED" || !Number.isSafeInteger(nextSequence) || nextSequence < 0
    || nextSequence <= (previous.last?.sequence ?? -1)) throw new Error(copy.propPractice.resetUnavailable);
  return initialPropState(rules, nextSequence);
}
export function funds(s: PropState, o = s.last) {
  const st = currentStage(s), profit = (o?.rawNet ?? st.anchor) - st.anchor;
  const balance = st.initialCapital + profit - st.grossPayout;
  const floor = Math.max(st.trailingFloor, st.permanentFloor ?? -Infinity);
  return { profit, balance, equity: balance + (o?.unrealized ?? 0), floor };
}
function checkRisk(s: PropState) {
  const f = funds(s);
  if (!s.result && s.last && f.equity <= f.floor) {
    s.result = "FAILED"; s.failure = { sequence: s.last.sequence, equity: f.equity, floor: f.floor, phase: s.phase };
    currentStage(s).endSequence = s.last.sequence;
  }
}
export function evaluationProgress(r: PropRules, s: PropState, includeOpenDay = false) {
  const st = s.stages[0], days = st.days.filter((d) => includeOpenDay || d.settled || d.stageEnded), net = (days.at(-1)?.endRawNet ?? st.anchor) - st.anchor;
  const tradingDays = days.filter((d) => d.traded).length;
  const bestDay = days.reduce((best, d) => Math.max(best, d.endRawNet - d.startRawNet), 0);
  const requiredProfit = Math.max(r.evaluation.target, r.evaluation.consistency ? bestDay / r.evaluation.consistency : 0);
  return { net, tradingDays, bestDay, requiredProfit,
    passed: net >= requiredProfit && (!r.evaluation.consistency || net > 0)
      && (r.evaluation.minTradingDays === null || tradingDays >= r.evaluation.minTradingDays) };
}

export function promotionPreview(r: PropRules, s: PropState) {
  const progress = evaluationProgress(r, s, true), f = funds(s);
  const available = s.phase === "EVALUATION" && !s.result && ["NONE", "DATA_END"].includes(s.pause)
    && !!s.last && s.last.flat && s.last.pending === 0 && f.equity > f.floor;
  return { ...progress, eligible: available && progress.passed };
}

/** Close the evaluation segment, without pretending an intraday switch is EOD. */
export function promotePropManually(r: PropRules, before: PropState): PropState {
  if (!promotionPreview(r, before).eligible) throw new Error(copy.propPractice.promotionUnavailable);
  const s = copyState(before), o = s.last!, st = currentStage(s);
  const day = st.days.at(-1);
  if (day) day.stageEnded = true;
  st.endSequence = o.sequence;
  s.phase = "FUNDED"; s.pausedDay = null;
  s.stages.push(newStage("FUNDED", r.funded.risk, o.rawNet, o.sequence + 1, o));
  return s;
}

/** Count settled funded days after the last successful payout day; keep the full ledger. */
export function payoutQualification(r: PropRules, s: PropState) {
  const st = currentStage(s), { qualifyingDays: requiredDays, qualifyingProfit } = r.funded;
  const start = st.qualifyingAfterDay === null ? 0 : st.days.findIndex(d => d.day === st.qualifyingAfterDay) + 1;
  const qualifyingDays = s.phase === "FUNDED" ? st.days.slice(start).filter(d => d.settled && d.traded
    && d.endRawNet - d.startRawNet >= (qualifyingProfit ?? Infinity)).length : 0;
  return { qualifyingDays, requiredDays, qualifyingProfit, passed: requiredDays === null || qualifyingDays >= requiredDays };
}

/** Consume only completed original results. No engine state is ever changed. */
export function observeProp(r: PropRules, before: PropState, observation: Observation): PropState {
  const s = copyState(before);
  if (s.result) return s;
  s.last = { ...observation };
  const st = currentStage(s);
  if (st.metrics) st.metrics = observeStageMetrics(st.metrics,
    observation.realizedPnl ?? observation.rawNet + (observation.totalFees ?? 0), observation.totalFees ?? 0,
    st.initialCapital + observation.rawNet - st.anchor + observation.unrealized);
  let day = st.days.at(-1);
  if (!day || day.day !== observation.day) {
    day = { day: observation.day, startRawNet: day?.endRawNet ?? st.anchor, endRawNet: observation.rawNet,
      balance: 0, traded: false, settled: false };
    st.days.push(day);
  }
  // Operations on the same source candle update the same unsettled day.
  day.endRawNet = observation.rawNet; day.balance = funds(s).balance; day.traded ||= observation.hadFill;
  checkRisk(s);
  return s;
}

/** EOD is final only once flat, or before the next actual day's first source candle. */
export function settlePropDay(r: PropRules, before: PropState): PropState {
  const s = copyState(before), o = s.last;
  if (!o || s.result) return s;
  checkRisk(s);
  if (s.result) return s;
  const st = currentStage(s), day = st.days.at(-1), rule = stageRules(r, s);
  if (!day) return s;
  if (!day.settled && rule.mode === "EOD_BALANCE") {
    st.highWater = Math.max(st.highWater, day.balance);
    st.trailingFloor = Math.max(st.trailingFloor, Math.min(rule.capOffset === null ? Infinity : st.initialCapital + rule.capOffset, st.highWater - rule.drawdown));
  }
  day.settled = true;
  checkRisk(s);
  if (!s.result && s.phase === "EVALUATION" && o.flat && o.pending === 0 && evaluationProgress(r, s).passed) {
    st.endSequence = o.sequence;
    s.phase = "FUNDED"; s.pause = "STAGE_WAIT"; s.pausedDay = o.day;
    s.stages.push(newStage("FUNDED", r.funded.risk, o.rawNet, o.sequence + 1, o));
  }
  return s;
}
export function preparePropDay(r: PropRules, before: PropState, day: string): { state: PropState; stop: boolean } {
  let s = copyState(before);
  const oldPhase = s.phase;
  if (s.last && s.last.day !== day) s = settlePropDay(r, s);
  if (s.result || oldPhase !== s.phase) return { state: s, stop: true };
  if ((s.pause === "STAGE_WAIT" || s.pause === "PAYOUT_DAY") && s.pausedDay !== day) { s.pause = "NONE"; s.pausedDay = null; }
  if (s.pause === "DATA_END") s.pause = "NONE";
  return { state: s, stop: s.pause === "BOUNDARY" };
}
export function payoutPreview(r: PropRules, s: PropState) {
  const f = funds(s), st = currentStage(s), p = r.payout;
  const floorAfter = Math.max(f.floor, p.permanentFloorOffset === null ? -Infinity : st.initialCapital + p.permanentFloorOffset);
  const remaining = Math.max(0, f.profit - st.grossPayout);
  const limits = { fraction: remaining * p.fraction, maximum: p.maximum,
    buffer: p.buffer === null ? null : f.balance - st.initialCapital - p.buffer, risk: f.balance - floorAfter - 0.01 };
  const limit = Math.min(limits.fraction, limits.maximum ?? Infinity, limits.buffer ?? Infinity, limits.risk);
  // A valid cent amount such as 0.29 must not lose a cent to multiplication's
  // binary representation. Genuine sub-cent limits still round strictly down.
  const maximum = Math.max(0, hasMoneyPrecision(limit) ? limit : Math.floor(limit * 100) / 100);
  const available = s.phase === "FUNDED" && !s.result && ["NONE", "DATA_END"].includes(s.pause) && !!s.last && s.last.flat && s.last.pending === 0;
  const qualification = payoutQualification(r, s);
  return { ...f, floorAfter, remaining, limits, maximum, qualification, eligible: available && qualification.passed && maximum >= p.minimum };
}
export function applyPayout(r: PropRules, before: PropState, amount: number) {
  const preview = payoutPreview(r, before);
  const received = Math.round(amount * r.payout.traderShare * 100) / 100;
  if (!preview.eligible || !hasMoneyPrecision(amount)
    || amount < r.payout.minimum || amount > preview.maximum || received <= 0 || preview.balance - amount <= preview.floorAfter) throw new Error(copy.propPractice.payoutInvalid);
  const s = copyState(before), st = currentStage(s);
  st.grossPayout += amount;
  st.qualifyingAfterDay = s.last!.day;
  if (r.payout.permanentFloorOffset !== null) st.permanentFloor = Math.max(st.permanentFloor ?? -Infinity, st.initialCapital + r.payout.permanentFloorOffset);
  s.totalRequested += amount; s.totalReceived = Math.round((s.totalReceived + received) * 100) / 100; s.payoutCount++;
  s.pause = "PAYOUT_DAY"; s.pausedDay = s.last!.day;
  const day = st.days.at(-1);
  if (day && !day.settled) day.balance = funds(s).balance;
  return { state: s, received, share: Math.round((amount - received) * 100) / 100,
    evidence: { sequence: s.last!.sequence, day: s.last!.day, balanceBefore: preview.balance, balanceAfter: funds(s).balance, floor: preview.floorAfter,
      qualification: preview.qualification } };
}
