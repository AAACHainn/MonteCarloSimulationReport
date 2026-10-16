import { z } from "zod";
import { chartPreferencesSchema } from "./chart-contract";

export const skillKeys = ["globalAssistant", "chartReading", "reviewDraft", "sessionReview"] as const;
export type SkillKey = typeof skillKeys[number];
export const capabilitySchema = z.enum(["UNKNOWN", "SUPPORTED", "UNSUPPORTED", "FAILED"]);
export const endpointSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  protocol: z.literal("chat-completions").default("chat-completions"),
  baseUrl: z.string().trim().max(2000).url().refine((s) => /^https?:\/\//i.test(s)),
  chatUrl: z.string().trim().max(2000).default(""),
  modelsUrl: z.string().trim().max(2000).default(""),
  tokenParameter: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
  adapterProfile: z.enum(["generic", "deepseek"]).optional(),
  toolTransport: z.enum(["stream", "nonstream"]).optional(),
  models: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  defaultModel: z.string().trim().max(160),
  apiKey: z.string().max(4096).optional(),
  clearApiKey: z.boolean().optional(),
  encryptedKey: z.string().optional(),
  capabilities: z.record(z.record(capabilitySchema)).default({}),
}).strict();
export type Endpoint = z.infer<typeof endpointSchema>;
export const skillSchema = z.object({
  enabled: z.boolean(), prompt: z.string().max(16000),
});
export const settingsSchema = z.object({
  schemaVersion: z.literal(1), activeEndpointId: z.string().max(100),
  endpoints: z.array(endpointSchema).max(12),
  skills: z.object({
    globalAssistant: skillSchema, chartReading: skillSchema,
    reviewDraft: skillSchema, sessionReview: skillSchema,
  }),
});
export type AiSettings = z.infer<typeof settingsSchema>;
export const contextRequestSchema = z.object({
  replaySessionId: z.string().min(1), entryId: z.string().optional(),
  projectionId: z.string().min(1), templateId: z.string().optional(),
  draft: z.string().max(8000).optional(),
  depth: z.enum(["quick", "full"]).default("quick"),
  chartPreferences: chartPreferencesSchema.optional(),
  timeframes: z.array(z.string().min(1).max(20)).min(1).max(4).optional(),
}).strict();
export const runRequestSchema = z.object({
  conversationId: z.string().min(1), contextId: z.string().optional(),
  task: z.enum(skillKeys), question: z.string().trim().min(1).max(8000),
  assetIds: z.array(z.string()).max(6).default([]),
  chartImages: z.boolean().default(false),
  executionMode: z.enum(["tools-v1", "fixed-v1"]).default("tools-v1"),
  requestId: z.string().uuid(),
}).strict();
export type RunInput = Omit<z.infer<typeof runRequestSchema>, "executionMode"> & { executionMode?: "tools-v1" | "fixed-v1" };
export const reviewResultSchema = z.object({
  draft: z.string().refine((s) => Array.from(s).length <= 2000),
  analysis: z.string().max(20000),
  sources: z.array(z.string()).max(100),
  missing: z.array(z.string().max(1000)).max(30),
}).strict();
export const sessionResultSchema = z.object({
  summary: z.string().max(30000),
  rules: z.array(z.object({
    rule: z.string().max(3000),
    supports: z.array(z.string()).max(100),
    counterexamples: z.array(z.string()).max(100),
    validation: z.string().max(3000),
  }).strict()).max(30),
  missing: z.array(z.string().max(1000)).max(50),
}).strict();
export const LIMITS = {
  inputChars: 48000, outputTokens: 4096, outputChars: 64000,
  modelMs: 120000, runMs: 300000, toolBytes: 32768,
  imageBytes: 4 * 1024 * 1024, totalImageBytes: 12 * 1024 * 1024,
  contextEntries: 5000, chartsPerContext: 100, batchEntries: 8,
  maxAnalysisCalls: 750, maxCumulativeChars: 5000000,
};
export function outputJsonSchema(task: "reviewDraft" | "sessionReview") {
  const string = { type: "string" }, strings = { type: "array", items: string };
  const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  return task === "reviewDraft"
    ? object({ draft: string, analysis: string, sources: strings, missing: strings })
    : object({ summary: string, rules: { type: "array", items: object({ rule: string, supports: strings, counterexamples: strings, validation: string }) }, missing: strings });
}
