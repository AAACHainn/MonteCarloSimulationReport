import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { readSettings, resolveEndpoint, resolveModel } from "./config";
import { createContext, readContext, checkCurrentContext, hashValue } from "./context";
import { contextRequestSchema, skillKeys, LIMITS } from "./schema";
import { generateTurn, type ModelMessage } from "./provider";
import { AiError } from "./errors";
import { withReplayJournalDisplayNumbers } from "@/lib/paper-trading/journal-numbering";
import { parseSourceInterval } from "@/lib/market-replay/types";
import { displayIntervalOptions } from "@/lib/market-replay/display-interval";
import { relevantHistory } from "./history";
import { rememberPlan } from "./planning-record";
import { limitsOverrideSchema, resolveLimits } from "./limits";
import { budgetError } from "./budget";
import { ROUTING_PROMPT } from "./system-prompts";
import type { ImageRequest } from "./chart-images-contract";

export const assistantPlanRequest = z.object({
  conversationId: z.string().min(1), question: z.string().trim().min(1).max(8000),
  contextId: z.string().optional(), page: contextRequestSchema.optional(),
  hasImages: z.boolean().optional(),
  limits: limitsOverrideSchema.optional(),
}).strict().refine((v) => !(v.contextId && v.page));
const decisionSchema = z.object({
  task: z.enum(skillKeys), target: z.enum(["none", "current", "session", "trade_number", "clarify"]),
  tradeNo: z.number().int().positive().nullable(), timeframes: z.array(z.string().min(1).max(20)).max(4),
  needsTemplate: z.boolean(), fullCharts: z.boolean(),
  needsChartImages: z.boolean().default(false), multipleCharts: z.boolean().default(false),
}).strict();
export type AssistantDecision = z.infer<typeof decisionSchema>;
export type AssistantPlan = {
  task: typeof skillKeys[number]; context: (Awaited<ReturnType<typeof createContext>>) | null;
  prepareImages: boolean; clarification?: string;
  imageRequest?: ImageRequest;
  planId?: string;
};

export async function prepareAssistant(input: z.infer<typeof assistantPlanRequest>, signal: AbortSignal): Promise<AssistantPlan> {
  const chat = await prisma.aiConversation.findUnique({ where: { id: input.conversationId } });
  if (!chat) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
  if (chat.activeRunId) throw new AiError("BUSY", copy.ai.busy, 409);
  const pinned = input.contextId ? await readContext(input.contextId) : null;
  if (pinned) await checkCurrentContext(pinned);
  const pointer = pinned ? { replaySessionId: pinned.replaySessionId, projectionId: pinned.projectionId,
    entryId: pinned.selectedEntryId, templateId: pinned.template?.id, draft: pinned.originalDraft, depth: pinned.depth,
    chartPreferences: pinned.chartPreferences, chartWindow: pinned.chartWindow } : input.page;
  const session = pointer ? await prisma.replaySession.findUnique({ where: { id: pointer.replaySessionId }, include: { dataset: true, activeProjection: true, progress: true } }) : null;
  if (pointer && (!session?.activeProjection || session.activeProjectionId !== pointer.projectionId || session.pendingCorrectionId)) throw new AiError("CONTEXT_CONFLICT", copy.ai.conflict, 409);
  const selected = pointer?.entryId ? await prisma.replayJournalEntry.findFirst({ where: { id: pointer.entryId, projectionId: pointer.projectionId,
    closedSequence: { lte: session!.activeProjection!.currentSequence } }, select: { id: true, accountNo: true } }) : null;
  if (pointer?.entryId && !selected) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
  const recent = await relevantHistory(input.conversationId, pointer ? { replaySessionId: pointer.replaySessionId, projectionId: pointer.projectionId, selectedEntryId: pointer.entryId } : null, "planning");
  const settings = await readSettings(), model = resolveEndpoint(settings.value);
  const limits = resolveLimits(settings.value.limits, input.limits);
  const messages: ModelMessage[] = [
    { role: "system", content: ROUTING_PROMPT },
    { role: "user", content: JSON.stringify({ question: input.question, hasUserImages: Boolean(input.hasImages),
      scope: session ? { sessionName: session.name, selectedTrade: selected ? { present: true } : null,
        templateSelected: Boolean(pointer?.templateId), currentChart: Boolean(input.page?.includeCurrentChart || pinned?.currentChart) } : null,
      history: recent.slice(-6).map((m) => ({ role: m.role, text: m.content.slice(0, 1200) })) }) },
  ];
  const started = Date.now();
  if (JSON.stringify(messages).length > limits.inputChars) throw budgetError("inputChars", JSON.stringify(messages).length, limits.inputChars);
  const turn = await generateTurn(model.endpoint, model.model, messages, signal, undefined, undefined, {}, { limits });
  const durationMs = Date.now() - started;
  signal.throwIfAborted();
  let decision: AssistantDecision;
  try { decision = decisionSchema.parse(JSON.parse(turn.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))); }
  catch { throw new AiError("ROUTING_INVALID", copy.ai.routingFailed, 502); }
  if (decision.fullCharts && decision.task !== "sessionReview") throw new AiError("ROUTING_INVALID", copy.ai.routingFailed, 502);
  const clarify = (message: string): AssistantPlan => ({ task: "globalAssistant", context: null, prepareImages: false, clarification: message });
  const finish = (result: AssistantPlan): AssistantPlan => ({ ...result, imageRequest: { multiple: decision.multipleCharts || decision.timeframes.length > 1, timeframes: decision.timeframes }, planId: rememberPlan({ conversationId: input.conversationId,
    questionHash: hashValue(input.question), contextId: result.context?.id ?? null, task: result.task,
    endpoint: model.endpoint.name, model: model.model, usage: turn.usage, durationMs, estimatedChars: JSON.stringify(messages).length,
    requestHash: hashValue(messages), decision, limits, }) });
  if (decision.target === "clarify") return clarify(copy.ai.clarifyScope);
  if (decision.target === "none") {
    if (decision.task === "reviewDraft" || decision.task === "sessionReview") return clarify(copy.ai.clarifyScope);
    resolveModel(settings.value, decision.task);
    return finish({ task: decision.task, context: null, prepareImages: false });
  }
  if (!pointer || !session) return clarify(copy.ai.clarifyScope);
  if (decision.task === "sessionReview" && decision.target !== "session") return clarify(copy.ai.clarifyScope);
  let entryId = decision.target === "current" ? pointer.entryId : undefined;
  let chartEntryIds: string[] | undefined;
  if (decision.target === "trade_number") {
    if (!decision.tradeNo) return clarify(copy.ai.clarifyTrade);
    const rows = await prisma.replayJournalEntry.findMany({ where: { projectionId: pointer.projectionId, closedSequence: { lte: session.activeProjection!.currentSequence } }, select: { id: true, accountNo: true }, take: LIMITS.contextEntries + 1 });
    if (rows.length > LIMITS.contextEntries) throw new AiError("SCOPE_LIMIT", copy.ai.tooLarge);
    const matches = (await withReplayJournalDisplayNumbers(rows, pointer.projectionId)).filter((e) => e.accountNo === decision.tradeNo);
    if (matches.length !== 1) return clarify(matches.length ? copy.ai.ambiguousTrade(decision.tradeNo) : copy.ai.tradeNotFound(decision.tradeNo));
    if (decision.task === "reviewDraft") entryId = matches[0].id;
    else chartEntryIds = [matches[0].id];
  }
  if (decision.task === "reviewDraft" && !entryId) return clarify(copy.ai.clarifyTrade);
  resolveModel(settings.value, decision.task);
  let templateId = pointer.templateId;
  if (decision.needsTemplate && !templateId) {
    const templates = await prisma.replayReviewTemplate.findMany({ select: { id: true }, take: 2 });
    if (templates.length !== 1) return clarify(copy.ai.clarifyTemplate);
    templateId = templates[0].id;
  }
  const includeCurrentChart = !entryId && !chartEntryIds && decision.target === "current" && Boolean(input.page?.includeCurrentChart || pinned?.currentChart);
  const supported = displayIntervalOptions(session.dataset.sourceIntervalSeconds!, pointer.chartWindow?.displayIntervalSeconds ?? session.progress?.displayIntervalSeconds ?? session.dataset.sourceIntervalSeconds!);
  if (decision.timeframes.some((t) => !supported.includes(parseSourceInterval(t) ?? -1))) throw new AiError("UNSUPPORTED_TIMEFRAME", copy.ai.unsupportedTimeframe);
  // Pinned evidence remains frozen for ordinary follow-ups. Scope changes create a new, explicit snapshot.
  const reusable = pinned && entryId === pinned.selectedEntryId && !chartEntryIds
    && templateId === pinned.template?.id && (!decision.fullCharts || pinned.depth === "full");
  const context = reusable ? { ...pinned, id: input.contextId! } : await createContext({
    replaySessionId: pointer.replaySessionId, projectionId: pointer.projectionId, entryId, templateId,
    draft: entryId === pointer.entryId ? pointer.draft : undefined, depth: !entryId && (decision.fullCharts || pointer.depth === "full") ? "full" : "quick",
    chartPreferences: pointer.chartPreferences, chartAccess: true, includeCurrentChart, chartEntryIds, chartWindow: includeCurrentChart ? pointer.chartWindow : undefined,
    timeframes: decision.timeframes.length ? decision.timeframes : undefined,
  });
  signal.throwIfAborted();
  return finish({ task: decision.task, context, prepareImages: context.depth === "full" || decision.needsChartImages || decision.task === "chartReading" || decision.task === "reviewDraft" || decision.timeframes.length > 0 });
}
