import { randomUUID } from "node:crypto";
import { AiError } from "./errors";
import { copy } from "@/lib/i18n";
import type { Usage } from "./provider";
import type { AiLimits } from "./limits";

export type PlanningRecord = {
  id: string; conversationId: string; questionHash: string; contextId: string | null; task: string;
  endpoint: string; model: string; usage: Usage; durationMs: number; estimatedChars: number;
  requestHash: string; decision: unknown; createdAt: number; reused?: boolean;
  limits?: AiLimits;
};
const state = globalThis as unknown as { aiPendingPlans?: Map<string, PlanningRecord> };
const pending = state.aiPendingPlans ??= new Map();
export function rememberPlan(record: Omit<PlanningRecord, "id" | "createdAt">) {
  const now = Date.now();
  for (const [id, plan] of pending) if (now - plan.createdAt > 600000) pending.delete(id);
  if (pending.size >= 200) pending.delete(pending.keys().next().value!);
  const id = randomUUID(); pending.set(id, { ...record, id, createdAt: now }); return id;
}
export function readPlan(id: string, expected: Pick<PlanningRecord, "conversationId" | "questionHash" | "contextId" | "task">) {
  const plan = pending.get(id);
  if (!plan || Date.now() - plan.createdAt > 600000 || Object.entries(expected).some(([key, value]) => plan[key as keyof PlanningRecord] !== value))
    throw new AiError("PLAN_EXPIRED", copy.ai.planExpired, 409);
  return plan;
}
export const forgetPlan = (id: string) => pending.delete(id);
