import { z } from "zod";

export const riskPreferencesSchema = z.object({
  riskMode: z.enum(["FIXED", "BALANCE_PERCENT"]).optional(),
  riskAmount: z.number().finite().positive().optional(),
  riskPercent: z.number().finite().positive().max(100).optional(),
  targetR: z.number().finite().positive().optional(),
}).strict().superRefine((value, context) => {
  if (value.riskMode === "FIXED" && value.riskAmount === undefined) context.addIssue({ code: "custom", path: ["riskAmount"], message: "Required" });
  if (value.riskMode === "BALANCE_PERCENT" && value.riskPercent === undefined) context.addIssue({ code: "custom", path: ["riskPercent"], message: "Required" });
});

export type RiskPreferencesInput = z.infer<typeof riskPreferencesSchema>;
export type RiskPreferences = Required<RiskPreferencesInput>;

export function normalizeRiskPreferences(input: unknown): RiskPreferences {
  const parsed = riskPreferencesSchema.safeParse(input);
  const value: RiskPreferencesInput = parsed.success ? parsed.data : {};
  return {
    riskMode: value.riskMode ?? (value.riskAmount === undefined ? "BALANCE_PERCENT" : "FIXED"),
    riskAmount: value.riskAmount ?? 500,
    riskPercent: value.riskPercent ?? 1,
    targetR: value.targetR ?? 2,
  };
}

/** Resolve only the next draft's default budget; the existing sizing algorithm is unchanged. */
export function defaultRiskAmount(preferences: RiskPreferences, balance: number) {
  return preferences.riskMode === "FIXED" ? preferences.riskAmount : Math.max(0, balance) * preferences.riskPercent / 100;
}
