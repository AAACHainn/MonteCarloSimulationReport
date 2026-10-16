import { z } from "zod";
import { copy } from "@/lib/i18n";

export const limitFields = {
  outputTokens: { min: 256, max: 65536, default: 4096 },
  inputChars: { min: 8000, max: 500000, default: 48000 },
  maxInputChars: { min: 8000, max: 5000000, default: 240000 },
  maxModelCalls: { min: 2, max: 64, default: 6 },
  maxToolCalls: { min: 1, max: 128, default: 12 },
  maxToolResultBytes: { min: 32768, max: 4194304, default: 262144 },
  maxAnalysisCalls: { min: 8, max: 2000, default: 750 },
  maxAnalysisChars: { min: 8000, max: 20000000, default: 5000000 },
  modelSeconds: { min: 15, max: 600, default: 120 },
  runSeconds: { min: 30, max: 3600, default: 300 },
} as const;
export type LimitKey = keyof typeof limitFields;
const number = (key: LimitKey) => z.number().int().min(limitFields[key].min).max(limitFields[key].max);
export const limitsOverrideSchema = z.object({ outputTokens: number("outputTokens").optional(), inputChars: number("inputChars").optional(),
  maxInputChars: number("maxInputChars").optional(), maxModelCalls: number("maxModelCalls").optional(), maxToolCalls: number("maxToolCalls").optional(),
  maxToolResultBytes: number("maxToolResultBytes").optional(), maxAnalysisCalls: number("maxAnalysisCalls").optional(), maxAnalysisChars: number("maxAnalysisChars").optional(),
  modelSeconds: number("modelSeconds").optional(), runSeconds: number("runSeconds").optional() }).strict();
export type AiLimits = Required<z.infer<typeof limitsOverrideSchema>>;
export const DEFAULT_LIMITS = Object.fromEntries(Object.entries(limitFields).map(([key, value]) => [key, value.default])) as AiLimits;
export const aiLimitsSchema = limitsOverrideSchema.transform((value): AiLimits => ({ ...DEFAULT_LIMITS, ...value })).superRefine((value, ctx) => {
  for (const key of ["maxInputChars", "maxAnalysisChars"] as const) if (value[key] < value.inputChars) ctx.addIssue({ code: "custom", path: [key], message: copy.ai.invalidLimits });
  if (value.maxAnalysisCalls <= value.maxModelCalls) ctx.addIssue({ code: "custom", path: ["maxAnalysisCalls"], message: copy.ai.invalidLimits });
  if (value.runSeconds < value.modelSeconds) ctx.addIssue({ code: "custom", path: ["runSeconds"], message: copy.ai.invalidLimits });
});
export const resolveLimits = (base?: Partial<AiLimits>, overrides?: Partial<AiLimits>) => aiLimitsSchema.parse({ ...base, ...overrides });
export const outputCharLimit = (limits: AiLimits) => Math.max(64000, limits.outputTokens * 8);
export const protocolByteLimit = (limits: AiLimits) => Math.max(1024 * 1024, limits.maxToolResultBytes * 4, limits.outputTokens * 128);
export type BudgetBlock = { resource: LimitKey | "outputChars" | "protocolBytes"; used: number | null; limit: number };
