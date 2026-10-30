import { currentStage, payoutAmountPreview, payoutPreview, type PropRules, type PropState } from "./rules";

export type PayoutLimitKey = keyof ReturnType<typeof payoutPreview>["limits"];
export type PayoutBlockReason = PayoutLimitKey | "phase" | "failed" | "stopped" | "STAGE_WAIT" | "PAYOUT_DAY" | "BOUNDARY"
  | "observation" | "positions" | "orders" | "qualifyingDays";
export type PayoutFundingGap = { additionalNetProfit: number; requiredBalance: number; retainedBalance: number | null };

/** Find the smallest cent-sized profit increase accepted by the existing amount preview.
 * Keep the current floor fixed: this explains today's preview, not future EOD changes.
 * The bounded integer search avoids duplicating payout formulas or rounding profit up.
 */
function fundingGap(rules: PropRules, state: PropState, preview: ReturnType<typeof payoutPreview>): PayoutFundingGap | null {
  if (state.phase !== "FUNDED" || state.result || !state.last || preview.maximum >= rules.payout.minimum
    || (rules.payout.maximum !== null && rules.payout.maximum < rules.payout.minimum)) return null;
  const last = state.last;
  const meetsMinimum = (cents: number) => payoutAmountPreview(rules, {
    ...state, last: { ...last, rawNet: last.rawNet + cents / 100 },
  }).maximum >= rules.payout.minimum;
  let lower = 0, upper = Math.max(1, Math.ceil(rules.payout.minimum * 100));
  while (Number.isSafeInteger(upper) && !meetsMinimum(upper)) upper *= 2;
  if (!Number.isSafeInteger(upper)) return null;
  while (upper - lower > 1) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (meetsMinimum(middle)) upper = middle; else lower = middle;
  }
  const additionalNetProfit = upper / 100;
  return { additionalNetProfit, requiredBalance: preview.balance + additionalNetProfit,
    retainedBalance: rules.payout.buffer === null ? null : currentStage(state).initialCapital + rules.payout.buffer };
}

/** Read-only explanations use the account's fixed snapshot and the authoritative preview. */
export function explainPayout(rules: PropRules, state: PropState, preview = payoutPreview(rules, state)) {
  const limits = (Object.entries(preview.limits) as Array<[PayoutLimitKey, number | null]>).map(([key, value]) => ({
    key, value, blocking: value !== null && value < rules.payout.minimum,
  }));
  const reasons: PayoutBlockReason[] = [];
  if (!preview.eligible) {
    if (state.result) reasons.push(state.result === "FAILED" ? "failed" : "stopped");
    if (state.phase !== "FUNDED") reasons.push("phase");
    if (state.pause !== "NONE" && state.pause !== "DATA_END") reasons.push(state.pause);
    if (!state.last) reasons.push("observation");
    else {
      if (!state.last.flat) reasons.push("positions");
      if (state.last.pending > 0) reasons.push("orders");
    }
    if (!preview.qualification.passed) reasons.push("qualifyingDays");
    if (preview.maximum < rules.payout.minimum) reasons.push(...limits.filter(limit => limit.blocking).map(limit => limit.key));
  }
  return { reasons, limits, gap: fundingGap(rules, state, preview) };
}
