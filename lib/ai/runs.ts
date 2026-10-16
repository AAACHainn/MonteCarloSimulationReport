import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { readSettings, resolveModel, ensureAiStorage } from "./config";
import { assetDataUrl } from "./assets";
import { checkCurrentContext, readContext, type ContextValue } from "./context";
import { AiError } from "./errors";
import { EVIDENCE_RULES } from "./prompts";
import { generateTurn, type ModelMessage, type Usage } from "./provider";
import { hashValue } from "./context";
import type { ResponseDetails } from "./response-details";
import { LIMITS, reviewResultSchema, sessionResultSchema, type RunInput, type Endpoint } from "./schema";
import { toolLoop } from "./tool-loop";
import { executeReadTool, type Receipt } from "./tools";
import { programBatch, coverageLedger, type CoverageBatch } from "./program-evidence";
import { relevantHistory } from "./history";
import { readPlan, forgetPlan, type PlanningRecord } from "./planning-record";
import { resolveLimits, type AiLimits, type BudgetBlock } from "./limits";
import { budgetError } from "./budget";

type RunSnapshot = { endpoint: Endpoint; model: string; prompt: string; question: string; assetIds: string[]; chartAssetIds: string[]; estimatedChars: number; historyBefore?: string; reference?: string; response?: ResponseDetails; executionMode?: "tools-v1" | "fixed-v1"; scopeSecret?: string; toolSchemaVersion?: string; adapterVersion?: string; contextHash?: string; routing?: PlanningRecord; limits?: AiLimits; budgetExceeded?: BudgetBlock };
type Checkpoint = { content: string; usage: Usage; stage?: string; coverage?: CoverageBatch }[];
const localControllers = new Map<string, AbortController>();
export async function recoverRuns() {
  const cutoff = new Date(Date.now() - 180000);
  const stale = await prisma.aiRun.findMany({ where: { status: { in: ["RUNNING", "QUEUED"] }, heartbeatAt: { lt: cutoff } }, select: { id: true, conversationId: true } });
  for (const run of stale) await prisma.$transaction(async (tx) => {
    const changed = await tx.aiRun.updateMany({ where: { id: run.id, status: { in: ["RUNNING", "QUEUED"] }, heartbeatAt: { lt: cutoff } }, data: { status: "INTERRUPTED", error: copy.ai.interrupted } });
    if (changed.count) await tx.aiConversation.updateMany({ where: { id: run.conversationId, activeRunId: run.id }, data: { activeRunId: null } });
  });
}
export async function createRun(input: RunInput) {
  await ensureAiStorage(); await recoverRuns();
  const duplicate = await prisma.aiRun.findUnique({ where: { id: input.requestId } });
  if (duplicate) {
    if (duplicate.conversationId !== input.conversationId || duplicate.task !== input.task || duplicate.contextId !== (input.contextId ?? null)
      || JSON.parse(duplicate.snapshot).question !== input.question) throw new AiError("INVALID", copy.ai.invalid);
    return duplicate;
  }
  const settings = await readSettings(), resolved = resolveModel(settings.value, input.task);
  const routing = input.planId ? readPlan(input.planId, { conversationId: input.conversationId, questionHash: hashValue(input.question), contextId: input.contextId ?? null, task: input.task }) : undefined;
  const limits = resolveLimits(routing?.limits ?? settings.value.limits, input.limits);
  if (routing?.limits && hashValue(limits) !== hashValue(routing.limits)) throw new AiError("PLAN_EXPIRED", copy.ai.planExpired, 409);
  const context = input.contextId ? await readContext(input.contextId) : null;
  if (context) await checkCurrentContext(context);
  if (input.executionMode !== "fixed-v1" && context?.originalDraft !== undefined && Array.from(context.originalDraft).length > 2000) throw new AiError("DRAFT_TOO_LONG", copy.ai.draftTooLong);
  if ((input.task === "reviewDraft" && !context?.selectedEntryId) || (input.task === "sessionReview" && (!context || context.selectedEntryId)))
    throw new AiError("CONTEXT_REQUIRED", copy.ai.selectContext);
  const assets = await prisma.aiAsset.findMany({ where: { id: { in: input.assetIds } } });
  if (assets.length !== input.assetIds.length || assets.some((a) => a.chartHash && a.contextId !== input.contextId)
    || assets.reduce((n, a) => n + a.bytes, 0) > LIMITS.totalImageBytes) throw new AiError("ASSET_SCOPE", copy.ai.tooLarge);
  const chartAssets = input.contextId ? await prisma.aiAsset.findMany({ where: { contextId: input.contextId, chartHash: { not: null } }, orderBy: { createdAt: "asc" } }) : [];
  const includeCharts = input.chartImages || context?.depth === "full";
  const selectedCharts = includeCharts && context ? context.charts.map((c) => chartAssets.find((a) => a.chartHash === c.hash)).filter((a): a is NonNullable<typeof a> => Boolean(a)) : [];
  if (includeCharts && selectedCharts.length !== context?.charts.length) throw new AiError("CHARTS_MISSING", copy.ai.capturing);
  const unitCount = context ? context.selectedEntryId ? Math.max(1, context.charts.length) : context.depth === "full" ? context.charts.length : Math.ceil(context.entries.length / LIMITS.batchEntries) : 1;
  const estimate = (routing?.estimatedChars ?? 0) + JSON.stringify(contextText(context)).length + unitCount * (resolved.prompt.length + EVIDENCE_RULES.length + input.question.length)
    + selectedCharts.length * 4000 + limits.inputChars;
  if (input.task === "sessionReview" && estimate > limits.maxAnalysisChars) throw budgetError("maxAnalysisChars", estimate, limits.maxAnalysisChars);
  if (input.task === "sessionReview" && unitCount + 1 + (routing ? 1 : 0) > limits.maxAnalysisCalls) throw budgetError("maxAnalysisCalls", unitCount + 1 + (routing ? 1 : 0), limits.maxAnalysisCalls);
  const snapshot: RunSnapshot = { ...resolved, question: input.question, assetIds: input.assetIds, chartAssetIds: selectedCharts.map((a) => a.id), estimatedChars: routing?.estimatedChars ?? 0, routing, limits,
    executionMode: context && input.executionMode !== "fixed-v1" ? "tools-v1" : "fixed-v1", scopeSecret: randomUUID(),
    toolSchemaVersion: "1", adapterVersion: (resolved.endpoint.adapterProfile ?? "generic") + ":1", contextHash: context ? hashValue(context) : undefined,
    reference: context ? context.sessionName + " · " + context.symbol + " · " + context.asOfTime + " · " + (context.selectedEntryId ? context.entries[0].sourceId : copy.ai.wholeSession) : copy.ai.noContext,
  };
  const created = await prisma.$transaction(async (tx) => {
    const claimed = await tx.aiConversation.updateMany({ where: { id: input.conversationId, activeRunId: null }, data: { activeRunId: input.requestId } });
    if (!claimed.count) throw new AiError("BUSY", copy.ai.busy, 409);
    const run = await tx.aiRun.create({ data: { id: input.requestId, conversationId: input.conversationId, contextId: input.contextId, task: input.task, snapshot: JSON.stringify(snapshot),
      ...(routing ? { usage: JSON.stringify([routing.usage]) } : {}) } });
    if (routing) await tx.aiRunStep.create({ data: { runId: run.id, stepNo: 0, phase: "ROUTING", status: "COMPLETED", adapterVersion: "assistant-routing:1", requestHash: routing.requestHash,
      payload: JSON.stringify(routing.decision), usage: JSON.stringify(routing.usage), durationMs: routing.durationMs } });
    await tx.aiMessage.create({ data: { conversationId: input.conversationId, runId: run.id, role: "user", content: input.question, contextId: input.contextId } });
    return run;
  });
  if (input.planId) forgetPlan(input.planId);
  return created;
}
export async function cancelRun(id: string) {
  localControllers.get(id)?.abort();
  const run = await prisma.aiRun.findUnique({ where: { id } });
  if (!run) return;
  await prisma.$transaction([
    prisma.aiRun.updateMany({ where: { id, status: { in: ["RUNNING", "QUEUED"] } }, data: { status: "CANCELLED", error: copy.ai.stopped } }),
    prisma.aiConversation.updateMany({ where: { id: run.conversationId, activeRunId: id }, data: { activeRunId: null } }),
  ]);
}
export async function retryRun(id: string, overrides?: Partial<AiLimits>) {
  const original = await prisma.aiRun.findUnique({ where: { id } });
  if (!original || ["QUEUED", "RUNNING"].includes(original.status)) throw new AiError("INVALID", copy.ai.invalid);
  const snapshot: RunSnapshot = JSON.parse(original.snapshot);
  if (original.contextId) await checkCurrentContext(await readContext(original.contextId));
  delete snapshot.response;
  delete snapshot.budgetExceeded;
  snapshot.limits = resolveLimits(snapshot.limits, overrides);
  if (snapshot.routing) snapshot.routing = { ...snapshot.routing, reused: true };
  const retryId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.aiConversation.updateMany({ where: { id: original.conversationId, activeRunId: null }, data: { activeRunId: retryId } });
    if (!claimed.count) throw new AiError("BUSY", copy.ai.busy, 409);
    const run = await tx.aiRun.create({ data: { id: retryId, conversationId: original.conversationId,
      contextId: original.contextId, task: original.task, snapshot: JSON.stringify({ ...snapshot, scopeSecret: randomUUID(), estimatedChars: 0, historyBefore: snapshot.historyBefore ?? original.createdAt.toISOString() }) } });
    await tx.aiMessage.create({ data: { conversationId: original.conversationId, runId: run.id, role: "user", content: snapshot.question, contextId: original.contextId } });
    return run;
  });
}
export function startAnalysisWorker(id: string) {
  const child = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "ai-analysis-worker.ts"), id], {
    cwd: process.cwd(), env: process.env, detached: false, stdio: "ignore", windowsHide: true,
  });
  child.on("error", () => { void cancelRun(id); }); child.unref();
  child.on("exit", (code) => {
    if (code === 0) return;
    void prisma.$transaction(async (tx) => {
      const failed = await tx.aiRun.updateMany({ where: { id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "INTERRUPTED", error: copy.ai.interrupted } });
      if (failed.count) await tx.aiConversation.updateMany({ where: { activeRunId: id }, data: { activeRunId: null } });
    }).catch(() => undefined);
  });
}
export async function resumeRun(id: string, overrides?: Partial<AiLimits>) {
  await recoverRuns();
  const original = await prisma.aiRun.findUnique({ where: { id }, select: { contextId: true } });
  if (original?.contextId) await checkCurrentContext(await readContext(original.contextId));
  return prisma.$transaction(async (tx) => {
    const run = await tx.aiRun.findUnique({ where: { id } });
    if (!run || run.task !== "sessionReview" || !["INTERRUPTED", "FAILED", "CANCELLED", "INVALID_RESULT"].includes(run.status)) throw new AiError("INVALID", copy.ai.invalid);
    const claimed = await tx.aiConversation.updateMany({ where: { id: run.conversationId, activeRunId: null }, data: { activeRunId: id } });
    if (!claimed.count) throw new AiError("BUSY", copy.ai.busy, 409);
    const snapshot: RunSnapshot = JSON.parse(run.snapshot); snapshot.limits = resolveLimits(snapshot.limits, overrides); delete snapshot.budgetExceeded; delete snapshot.response;
    await tx.aiRun.update({ where: { id }, data: { status: "QUEUED", error: null, heartbeatAt: new Date(), snapshot: JSON.stringify(snapshot) } });
    return run;
  });
}
function contextText(context: ContextValue | null) {
  if (!context) return { mode: "general", warnings: ["No structured chart or account data attached. User images, if any, are unverified."] };
  const selected = context.entries.find((entry) => entry.id === context.selectedEntryId);
  const relevantEvents = (context.events ?? []).filter((event) => selected ? event.exactLogicalKeys?.includes(selected.logicalKey)
    : context.entries.some((entry) => entry.cycleKey && entry.cycleKey === event.cycleKey));
  return {
    mode: context.mode, capturedAt: context.capturedAt, sessionName: context.sessionName,
    symbol: context.symbol, timezone: context.timezone, endSequence: context.endSequence, asOfTime: context.asOfTime,
    template: context.template, originalDraft: context.originalDraft,
    metrics: context.selectedEntryId ? undefined : context.metrics, warnings: context.warnings,
    chartCoverage: context.depth, entries: context.entries.map((e) => ({
      sourceId: e.sourceId, direction: e.direction, quantity: e.quantity,
      openedAt: e.openedAt, closedAt: e.closedAt, entryPrice: e.entryPrice, exitPrice: e.exitPrice,
      initialStopPrice: e.initialStopPrice, initialRisk: e.initialRisk, actualRisk: e.actualRisk,
      gainLossPricePointsBeforeFees: e.gainLoss, setup: e.setupOption, reasons: e.tradeReasons,
      review: e.review, reviewOrigin: e.reviewOrigin, discipline: e.discipline,
    })),
    events: relevantEvents,
    executionLimitations: selected && !relevantEvents.length ? ["NOT_RELIABLY_LINKED"] : [],
    charts: context.charts.map((c) => ({ sourceId: c.sourceId, fields: ["openTime", "firstSequence", "lastSequence", "open", "high", "low", "close", "volume", "status"],
      bars: c.window.bars.map((b) => [b.timestamp, b.firstSequence, b.lastSequence, b.open, b.high, b.low, b.close, b.volume, b.status]) })),
  };
}
export function validatedResult(task: string, text: string, context: ContextValue | null, receipts?: Receipt[]) {
  if (task !== "reviewDraft" && task !== "sessionReview") return null;
  try {
    const json = JSON.parse(text.replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/, ""));
    const parsed = task === "reviewDraft" ? reviewResultSchema.parse(json) : sessionResultSchema.parse(json);
    const allowed = new Set(receipts ? receipts.map((r) => r.sourceRef) : ["metrics:session", ...(context?.metrics.journalGroups.map((g) => g.id) ?? []), ...(context?.entries.map((e) => e.sourceId) ?? []), ...(context?.events?.map((e) => e.sourceId) ?? []), ...(context?.charts.map((c) => c.sourceId) ?? [])]);
    const sources = "draft" in parsed ? parsed.sources : parsed.rules.flatMap((r) => [...r.supports, ...r.counterexamples]);
    if (sources.some((source) => !allowed.has(source))) return null;
    if (receipts && "draft" in parsed && !parsed.sources.some((s) => receipts.some((r) => r.sourceRef === s && r.evidenceKind === "FACTS"))) return null;
    if (receipts && "rules" in parsed && parsed.rules.some((rule) => !rule.supports.length || !rule.validation.trim())) return null;
    return parsed;
  } catch { return null; }
}
export function resultText(result: NonNullable<ReturnType<typeof validatedResult>>) {
  return "draft" in result
    ? result.draft + "\n\n" + result.analysis + "\n\n" + result.missing.join("\n")
    : result.summary + "\n\n" + result.rules.map((r) => r.rule + "\n" + copy.ai.supports + ": " + r.supports.join(", ") + "\n" + copy.ai.counterexamples + ": " + r.counterexamples.join(", ") + "\n" + r.validation).join("\n\n") + "\n\n" + result.missing.join("\n");
}
export async function executeRun(id: string, emit: (event: unknown) => void = () => undefined, externalSignal?: AbortSignal) {
  const initial = await prisma.aiRun.findUniqueOrThrow({ where: { id } });
  const limits = resolveLimits(JSON.parse(initial.snapshot).limits);
  const claimed = await prisma.aiRun.updateMany({ where: { id, status: "QUEUED" }, data: { status: "RUNNING", heartbeatAt: new Date() } });
  if (!claimed.count) return;
  const controller = new AbortController(); localControllers.set(id, controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.runSeconds * 1000), ...(externalSignal ? [externalSignal] : [])]);
  const poll = setInterval(() => {
    void prisma.aiRun.findUnique({ where: { id }, select: { status: true } }).then((r) => {
      if (r?.status !== "RUNNING") controller.abort();
      else return prisma.aiRun.updateMany({ where: { id, status: "RUNNING" }, data: { heartbeatAt: new Date() } });
    }).catch(() => controller.abort());
  }, 1000);
  try {
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id } }), config: RunSnapshot = JSON.parse(run.snapshot);
    config.chartAssetIds ??= [];
    const context = run.contextId ? await readContext(run.contextId) : null;
    if (config.executionMode === "tools-v1" && (config.toolSchemaVersion !== "1" || !config.scopeSecret || config.contextHash !== hashValue(context))) throw new AiError("STALE_CONTEXT", copy.ai.conflict);
    const checkpoint: Checkpoint = JSON.parse(run.checkpoint), usages: Usage[] = JSON.parse(run.usage);
    let calls = run.calls, totalChars = config.estimatedChars;
    async function call(payload: unknown, imageIds: string[], stream = false, json = false, history: ModelMessage[] = []) {
      signal.throwIfAborted();
      const requestHash = hashValue({ payload, imageIds, history, json });
      if (config.executionMode === "tools-v1") {
        const completed = await prisma.aiRunStep.findFirst({ where: { runId: id, phase: "PROGRAM", status: "COMPLETED", requestHash }, orderBy: { stepNo: "asc" } });
        if (completed) { const turn = JSON.parse(completed.payload); return { content: turn.content as string, usage: turn.usage as Usage }; }
      }
      const text = JSON.stringify(payload), cost = text.length + config.prompt.length + EVIDENCE_RULES.length + config.question.length + history.reduce((n, m) => n + JSON.stringify(m).length, 0) + imageIds.length * 4000;
      const routingCalls = config.routing && !config.routing.reused ? 1 : 0;
      const maxCalls = run.task === "sessionReview" && config.executionMode === "tools-v1" ? limits.maxAnalysisCalls - limits.maxModelCalls - routingCalls : run.task === "sessionReview" ? limits.maxAnalysisCalls - routingCalls : limits.maxModelCalls - routingCalls;
      const maxChars = run.task === "sessionReview" ? limits.maxAnalysisChars : limits.maxInputChars;
      if (cost > limits.inputChars) throw budgetError("inputChars", cost, limits.inputChars);
      const reserveChars = config.executionMode === "tools-v1" ? limits.inputChars : 0;
      if (totalChars + cost + reserveChars > maxChars) throw budgetError(run.task === "sessionReview" ? "maxAnalysisChars" : "maxInputChars", totalChars + cost + reserveChars, maxChars);
      if (calls >= maxCalls) throw budgetError(run.task === "sessionReview" ? "maxAnalysisCalls" : "maxModelCalls", calls + routingCalls + (config.executionMode === "tools-v1" ? limits.maxModelCalls : 0) + 1, run.task === "sessionReview" ? limits.maxAnalysisCalls : limits.maxModelCalls);
      totalChars += cost; calls += 1;
      delete config.response;
      await prisma.aiRun.update({ where: { id }, data: { calls, snapshot: JSON.stringify({ ...config, estimatedChars: totalChars }) } });
      usages.push({ input: null, output: null });
      await prisma.aiRun.update({ where: { id }, data: { usage: JSON.stringify(usages) } });
      const parts: Exclude<ModelMessage["content"], string> = [{ type: "text", text: config.question + "\nATTACHED_IMAGE_COUNT=" + imageIds.length + "\nREFERENCE_DATA:\n" + text }];
      for (const assetId of imageIds) parts.push({ type: "image_url", image_url: { url: await assetDataUrl(assetId, signal) } });
      if (stream) emit({ type: "response-start", startedAt: new Date().toISOString() });
      let answer: { content: string; usage: Usage };
      const requestMessages: ModelMessage[] = [{ role: "system", content: config.prompt + "\n" + EVIDENCE_RULES }, ...history, { role: "user", content: parts }];
      if (config.executionMode === "tools-v1") await prisma.aiRunStep.create({ data: { runId: id, stepNo: calls, phase: "PROGRAM", status: "REQUESTED", adapterVersion: (config.endpoint.adapterProfile ?? "generic") + ":1", requestHash } });
      try {
        const turn = await generateTurn(config.endpoint, config.model, requestMessages, signal,
          stream ? (delta) => emit({ type: "delta", text: delta }) : undefined,
          json ? run.task === "reviewDraft" ? "reviewDraft" : "sessionReview" : undefined,
          { ...(stream ? { onReasoning: (text: string) => emit({ type: "reasoning", text }), onDetails: (details: ResponseDetails) => { config.response = details; } } : {}), onUsage: (usage) => { usages[usages.length - 1] = usage; } }, { limits });
        answer = { content: turn.content, usage: turn.usage };
        if (config.executionMode === "tools-v1") {
          signal.throwIfAborted();
          await prisma.$transaction(async (tx) => {
            const active = await tx.aiRun.updateMany({ where: { id, status: "RUNNING" }, data: { heartbeatAt: new Date() } });
            if (!active.count) throw new AiError("CANCELLED", copy.ai.stopped);
            await tx.aiRunStep.update({ where: { runId_stepNo: { runId: id, stepNo: calls } }, data: { status: "COMPLETED", payload: JSON.stringify(turn), usage: JSON.stringify(turn.usage) } });
          });
        }
      } finally {
        await prisma.aiRun.update({ where: { id }, data: { usage: JSON.stringify(usages) } });
        if (config.response) {
          await prisma.aiRun.update({ where: { id }, data: { snapshot: JSON.stringify({ ...config, estimatedChars: totalChars }) } });
          emit({ type: "response-details", details: config.response });
        }
      }
      usages[usages.length - 1] = answer.usage;
      await prisma.aiRun.update({ where: { id }, data: { usage: JSON.stringify(usages) } });
      return answer;
    }
    let answer: { content: string; usage: Usage };
    let receipts: Receipt[] | undefined, canAdopt = true;
    if (context && config.executionMode === "tools-v1" && run.task !== "sessionReview") {
      const history = await relevantHistory(run.conversationId, context, id, config.historyBefore ? new Date(config.historyBefore) : undefined);
      const references = history.map((m) => ({ role: "user" as const, content: "HISTORICAL_REFERENCE_ONLY (not current evidence):\n" + m.content }));
      const loop = await toolLoop(id, { id, secret: config.scopeSecret!, context }, config, signal, emit, references);
      answer = loop.answer; receipts = loop.receipts; canAdopt = loop.canAdopt;
    } else if (context && (run.task === "sessionReview" || (context.selectedEntryId && context.charts.length > 1))) {
      const units: Array<{ entries: ContextValue["entries"]; charts: ContextValue["charts"] }> = [];
      if (context.depth === "full" || context.selectedEntryId) {
        for (let offset = 0; offset < context.charts.length; offset += 1) {
          const charts = context.charts.slice(offset, offset + 1);
          units.push({ charts, entries: context.entries.filter((e) => charts.some((c) => c.entryId === e.id)) });
        }
        const withoutCharts = context.entries.filter((e) => !context.charts.some((c) => c.entryId === e.id));
        for (let offset = 0; offset < withoutCharts.length; offset += LIMITS.batchEntries) units.push({ entries: withoutCharts.slice(offset, offset + LIMITS.batchEntries), charts: [] });
      } else for (let offset = 0; offset < context.entries.length; offset += LIMITS.batchEntries)
        units.push({ entries: context.entries.slice(offset, offset + LIMITS.batchEntries), charts: [] });
      for (let i = checkpoint.filter((p) => !p.stage).length; i < units.length; i++) {
      const unit = units[i], assets = await prisma.aiAsset.findMany({ where: { contextId: run.contextId, chartHash: { in: unit.charts.map((c) => c.hash) } }, orderBy: { createdAt: "asc" } });
        const uniqueAssets = unit.charts.map((c) => assets.find((a) => a.chartHash === c.hash && config.chartAssetIds.includes(a.id))?.id).filter((s): s is string => Boolean(s));
        const batch = config.executionMode === "tools-v1" ? programBatch({ id, secret: config.scopeSecret!, context }, unit.entries, unit.charts, unit.charts.filter((c) => assets.some((a) => a.chartHash === c.hash && uniqueAssets.includes(a.id))).map((c) => c.hash), signal) : null;
        const partial = await call({ ...(batch?.payload ?? contextText({ ...context, entries: unit.entries, charts: unit.charts })), instruction: "This is one batch only. Extract concise observations and source IDs; do not claim complete coverage. Keep under 1500 characters. Include both support and contrary cases; an empty review is still a real sample." }, uniqueAssets);
        checkpoint.push({ ...partial, ...(batch ? { coverage: batch.coverage } : {}) }); signal.throwIfAborted();
        const saved = await prisma.aiRun.updateMany({ where: { id, status: "RUNNING" }, data: { checkpoint: JSON.stringify(checkpoint) } });
        if (!saved.count) throw new AiError("CANCELLED", copy.ai.stopped);
        emit({ type: "progress", done: i + 1, total: units.length });
        if (batch) emit({ type: "coverage_updated", runId: id, stepNo: calls, eventNo: calls * 10, coverage: coverageLedger(context, checkpoint.flatMap((p) => p.coverage ? [p.coverage] : [])) });
      }
      let summaries = checkpoint.filter((p) => !p.stage).map((p) => p.content), level = 0;
      while (JSON.stringify(summaries).length > 24000) {
        const groups: string[][] = []; let group: string[] = [], size = 0;
        for (const summary of summaries) {
          if (summary.length > 20000) throw new AiError("SUMMARY_SIZE", copy.ai.summaryTooLarge);
          if (size + summary.length > 20000 && group.length) { groups.push(group); group = []; size = 0; }
          group.push(summary); size += summary.length;
        }
        if (group.length) groups.push(group);
        const reduced: string[] = [];
        for (let i = 0; i < groups.length; i++) {
          const stage = "reduce:" + level + ":" + i, existing = checkpoint.find((p) => p.stage === stage);
          if (existing) { reduced.push(existing.content); continue; }
          const result = await call({ batches: groups[i], instruction: "Compress all these batches into under 1200 characters. Preserve useful observations, counterexamples and actual source IDs. No overall statistical claims." }, []);
          if (result.content.length > 4000) throw new AiError("SUMMARY_SIZE", copy.ai.summaryTooLarge);
          checkpoint.push({ ...result, stage }); reduced.push(result.content);
          const saved = await prisma.aiRun.updateMany({ where: { id, status: "RUNNING" }, data: { checkpoint: JSON.stringify(checkpoint) } });
          if (!saved.count) throw new AiError("CANCELLED", copy.ai.stopped);
        }
        summaries = reduced; if (++level > 6) throw new AiError("SUMMARY_SIZE", copy.ai.summaryTooLarge);
      }
      if (config.executionMode === "tools-v1") {
        const scope = { id, secret: config.scopeSecret!, context };
        const coverage = coverageLedger(context, checkpoint.flatMap((p) => p.coverage ? [p.coverage] : []));
        if (!coverage.complete) throw new AiError("INCOMPLETE_COVERAGE", copy.ai.invalidResult);
        const overall = executeReadTool(scope, "get_session_statistics", { view: "overall", cursor: null, limit: null }, signal);
        const template = context.template ? executeReadTool(scope, "get_review_template", {}, signal) : null;
        const programReceipts = [...checkpoint.flatMap((p) => p.coverage?.receipts ?? []), ...overall.sources.map((r) => ({ ...r, readVia: "PROGRAM_INPUT" as const })), ...(template?.sources.map((r) => ({ ...r, readVia: "PROGRAM_INPUT" as const })) ?? [])];
        config.estimatedChars = totalChars;
        const loop = await toolLoop(id, scope, config, signal, emit, [{ role: "user", content: JSON.stringify({ programInput: { overall, template, coverage, batches: summaries }, instruction: "Synthesize every program batch; evidence receipts already belong to supplied inputs, never invent tool messages. Follow task JSON schema. Candidate rules require supports, counterexamples, gaps and next-session validation. Setup net statistics remain unavailable." }) }], programReceipts);
        answer = loop.answer; receipts = loop.receipts;
      } else answer = await call({ metrics: context.selectedEntryId ? undefined : context.metrics, warnings: context.warnings,
        template: context.template, originalDraft: context.originalDraft, batches: summaries,
        instruction: "Synthesize every batch. Follow the configured task output schema. Patterns are exploratory and require counterexamples." },
        config.assetIds, true, ["reviewDraft", "sessionReview"].includes(run.task));
    } else {
      const history = await relevantHistory(run.conversationId, context, id, config.historyBefore ? new Date(config.historyBefore) : undefined);
      const messages: ModelMessage[] = []; let length = 0;
      for (const message of history) {
        if (length + message.content.length > 8000) continue;
        length += message.content.length; messages.push({ role: message.role === "user" ? "user" : "assistant", content: message.content });
      }
      answer = await call(contextText(context), [...config.assetIds, ...(config.chartAssetIds ?? [])], true, run.task === "reviewDraft", messages);
    }
    signal.throwIfAborted();
    const result = run.task === "reviewDraft" && !canAdopt ? null : validatedResult(run.task, answer.content, context, receipts), content = result ? resultText(result) : answer.content;
    await prisma.$transaction(async (tx) => {
      const valid = Boolean(result) || !["reviewDraft", "sessionReview"].includes(run.task);
      const current = await tx.aiRun.updateMany({ where: { id, status: "RUNNING" }, data: { status: valid ? "COMPLETED" : "INVALID_RESULT", error: valid ? null : copy.ai.invalidResult } });
      const conversation = await tx.aiConversation.updateMany({ where: { id: run.conversationId, activeRunId: id }, data: { activeRunId: null } });
      if (!current.count || !conversation.count) throw new AiError("CANCELLED", copy.ai.stopped);
      await tx.aiMessage.create({ data: { role: "assistant", status: valid ? "COMPLETED" : "INVALID_RESULT", conversationId: run.conversationId, runId: id, content, result: result ? JSON.stringify(result) : null, contextId: run.contextId } });
      if (run.task === "sessionReview" && context && result) await tx.aiAnalysis.upsert({
        where: { runId: id }, create: { id: randomUUID(), runId: id, replaySessionId: context.replaySessionId, projectionId: context.projectionId, contextId: run.contextId!, content, result: JSON.stringify(result) },
        update: { content, result: JSON.stringify(result) },
      });
    });
    emit({ type: "done", valid: Boolean(result) || !["reviewDraft", "sessionReview"].includes(run.task) });
  } catch (error) {
    const cancelled = controller.signal.aborted || externalSignal?.aborted;
    const status = cancelled ? "CANCELLED" : signal.aborted ? "INTERRUPTED" : "FAILED";
    const failure = !cancelled && signal.aborted ? budgetError("runSeconds", limits.runSeconds, limits.runSeconds) : error;
    const message = cancelled ? copy.ai.stopped : failure instanceof AiError ? failure.message : copy.ai.interrupted;
    const latest = await prisma.aiRun.findUniqueOrThrow({ where: { id } });
    const snapshot: RunSnapshot = JSON.parse(latest.snapshot);
    if (failure instanceof AiError && failure.budget) snapshot.budgetExceeded = failure.budget;
    await prisma.$transaction([
      prisma.aiRun.updateMany({ where: { id, status: "RUNNING" }, data: { status, error: message, snapshot: JSON.stringify(snapshot) } }),
      prisma.aiConversation.updateMany({ where: { activeRunId: id }, data: { activeRunId: null } }),
    ]);
    emit({ type: "error", error: message });
  } finally { clearInterval(poll); localControllers.delete(id); }
}
