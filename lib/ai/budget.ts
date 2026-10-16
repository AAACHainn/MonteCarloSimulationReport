import { copy } from "@/lib/i18n";
import { AiError } from "./errors";
import { resolveLimits, type AiLimits, type BudgetBlock } from "./limits";
import type { Usage } from "./provider";
import type { ResponseDetails } from "./response-details";
export function budgetError(resource: BudgetBlock["resource"], used: number | null, limit: number) {
  const error = new AiError("BUDGET", copy.ai.budgetExceeded(resource, used, limit));
  error.budget = { resource, used, limit }; return error;
}
export type BudgetView = {
  limits: AiLimits; task: string; modelCalls: number; toolCalls: number; estimatedChars: number;
  inputTokens: number; outputTokens: number; totalTokens: number | null; unreportedCalls: number;
  inputReported: boolean; outputReported: boolean;
  lastUsage: Usage | null; blocked?: BudgetBlock; legacy: boolean;
};
export function budgetView(run: { task: string; calls: number; usage: string; snapshot: string }, toolCalls: number): BudgetView {
  const snapshot = JSON.parse(run.snapshot) as { limits?: AiLimits; estimatedChars?: number; budgetExceeded?: BudgetBlock; routing?: { reused?: boolean }; response?: ResponseDetails };
  const usages: Usage[] = JSON.parse(run.usage);
  const inputTokens = usages.reduce((n, u) => n + (u.input ?? 0), 0), outputTokens = usages.reduce((n, u) => n + (u.output ?? 0), 0);
  const modelCalls = run.calls + (snapshot.routing && !snapshot.routing.reused ? 1 : 0);
  const unreportedCalls = Math.max(0, modelCalls - usages.length) + usages.filter((u) => u.input === null || u.output === null).length;
  return { limits: resolveLimits(snapshot.limits), task: run.task, modelCalls, toolCalls, estimatedChars: snapshot.estimatedChars ?? 0,
    inputTokens, outputTokens, totalTokens: modelCalls && !unreportedCalls ? inputTokens + outputTokens : null, unreportedCalls,
    inputReported: usages.some((u) => u.input !== null), outputReported: usages.some((u) => u.output !== null),
    lastUsage: usages.at(-1) ?? snapshot.response?.usage ?? null, blocked: snapshot.budgetExceeded, legacy: !snapshot.limits };
}
