export const achievementCatalog = {
  "first-cycle": { metric: "completed-cycles", category: "trading", thresholds: [1] },
  "completed-cycles": { metric: "completed-cycles", category: "trading", thresholds: [100, 500, 1000] },
  "first-review": { metric: "completed-reviews", category: "review", thresholds: [1] },
  "completed-reviews": { metric: "completed-reviews", category: "review", thresholds: [10, 50, 100] },
  "passed-evaluations": { metric: "passed-evaluations", category: "prop", thresholds: [1, 5, 10, 20] },
  "successful-payouts": { metric: "successful-payouts", category: "prop", thresholds: [1, 5, 10, 20] },
  "payouts-in-round": { metric: "payouts-in-round", category: "prop", thresholds: [3, 5] },
  foundation: { metric: "foundation", category: "growth", thresholds: [1] },
  "stop-loss-streak": { metric: "stop-loss-streak", category: "trading", thresholds: [5, 10] },
  "take-profit-streak": { metric: "take-profit-streak", category: "trading", thresholds: [5, 10] },
} as const;

export type AchievementKey = keyof typeof achievementCatalog;
export type AchievementCategory = (typeof achievementCatalog)[AchievementKey]["category"];
export const achievementKeys = Object.keys(achievementCatalog) as [AchievementKey, ...AchievementKey[]];
export const achievementCategories = ["trading", "review", "prop", "growth"] as const;
export const achievementStageCount = achievementKeys.reduce((total, key) => total + achievementCatalog[key].thresholds.length, 0);

export const metricFingerprints = {
  "completed-cycles": "1:growth-cycle",
  "completed-reviews": "1:growth-first-review",
  "passed-evaluations": "1:growth-promotion",
  "successful-payouts": "1:growth-payout",
  "payouts-in-round": "1:growth-payout-scope",
  foundation: "1:realm-attainment",
  "stop-loss-streak": "1:ordered-exits-v1",
  "take-profit-streak": "1:ordered-exits-v1",
} as const;
export type MetricKey = keyof typeof metricFingerprints;
export const metricKeys = Object.keys(metricFingerprints) as [MetricKey, ...MetricKey[]];
export const catalogVersion = "1";
export const tierKey = (index: number) => `tier-${index + 1}`;
export const isStreak = (metric: MetricKey) => metric === "stop-loss-streak" || metric === "take-profit-streak";

export function metricPlanFingerprint(metrics: MetricKey[]) {
  return JSON.stringify([catalogVersion, metrics.map(key => [key, metricFingerprints[key]])]);
}
