/** V1 parameters are versioned proposals; replay settled deltas rather than repricing history. */
export const GROWTH_RULE_VERSION = "user-growth-v1";
export const GROWTH_XP = { CYCLE: 5, REVIEW: 10, EVALUATION: 100, PAYOUT_FIRST: 200 } as const;
export const QI_THRESHOLDS = [100, 400, 850, 1450, 2200, 3100, 4150, 5350, 6850, 8650, 10900, 13600] as const;
export const FOUNDATION_REQUIREMENTS = { totalXp: 18100, completedCycles: 1200, completedReviews: 600, passedEvaluations: 20, successfulPayouts: 10, receivedUsdtMinor: BigInt(10_000_000) } as const;
export type GrowthTotals = { totalXp: number; completedCycles: number; completedReviews: number; passedEvaluations: number; successfulPayouts: number; receivedUsdtMinor: bigint };
export type GrowthRealm = { realm: "MORTAL" | "QI" | "FOUNDATION"; layer: number };
export const emptyGrowthTotals = (): GrowthTotals => ({ totalXp: 0, completedCycles: 0, completedReviews: 0, passedEvaluations: 0, successfulPayouts: 0, receivedUsdtMinor: BigInt(0) });
export function growthRealm(totalXp: number, foundation = false): GrowthRealm {
  if (foundation) return { realm: "FOUNDATION", layer: 1 };
  if (!Number.isSafeInteger(totalXp) || totalXp < 0) throw new Error("Invalid accumulated experience");
  const layer = QI_THRESHOLDS.filter(value => totalXp >= value).length;
  return { realm: layer ? "QI" : "MORTAL", layer };
}
export function growthSegment(totalXp: number, foundation = false) {
  const current = growthRealm(totalXp, foundation);
  if (current.realm === "FOUNDATION") return undefined;
  const start = current.layer ? QI_THRESHOLDS[current.layer - 1] : 0;
  const end = current.layer === 12 ? FOUNDATION_REQUIREMENTS.totalXp : QI_THRESHOLDS[current.layer];
  return { value: totalXp - start, max: end - start, nextLayer: current.layer + 1 };
}
export function foundationReady(totals: GrowthTotals) {
  return (Object.keys(FOUNDATION_REQUIREMENTS) as Array<keyof GrowthTotals>).every(key => totals[key] >= FOUNDATION_REQUIREMENTS[key]);
}
/** Existing payouts are already rounded to two decimal places by the account rules. */
export function receivedUsdtMinor(received: number): bigint {
  if (!Number.isFinite(received) || received < 0 || received > Number.MAX_SAFE_INTEGER / 100) throw new Error("Invalid received amount");
  const text = received.toFixed(2);
  if (Number(text) !== received) throw new Error("Received amount exceeds existing precision");
  return BigInt(text.replace(".", ""));
}
export function reviewEarnsFirstCompletion(previous: string, next: string, verifiedAiAdoption = false) {
  return !!next.trim() && (previous.trim() !== next.trim() || verifiedAiAdoption);
}
