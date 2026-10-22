import { retrySqliteWrite } from "@/lib/sqlite-write";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { aiError, AiError, assertOrigin, readBody } from "@/lib/ai/errors";
import { ensureAiStorage, readSettings, saveSettings, publicSettings, endpointUrls } from "@/lib/ai/config";
import { createContext, readContext, checkCurrentContext, isContextStale } from "@/lib/ai/context";
import { saveAsset, readAsset } from "@/lib/ai/assets";
import { createRun, cancelRun, executeRun, recoverRuns, resumeRun, retryRun, startAnalysisWorker } from "@/lib/ai/runs";
import { boundedJson, requestHeaders, testConnection } from "@/lib/ai/provider";
import { contextRequestSchema, runRequestSchema, LIMITS } from "@/lib/ai/schema";
import { DEFAULT_PROMPTS } from "@/lib/ai/prompts";
import { reviewFactsHash } from "@/lib/ai/review-baseline";
import { assistantPlanRequest, prepareAssistant } from "@/lib/ai/assistant-plan";
import { limitsOverrideSchema } from "@/lib/ai/limits";
import { budgetView } from "@/lib/ai/budget";
import { listChartCaptures, claimChartCapture, finishChartCapture } from "@/lib/ai/chart-captures";
import { loadDisplayedImages } from "@/lib/ai/display-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
async function handle(request: Request, { params }: Context) {
  try {
    const { path } = await params, [kind, id, action] = path;
    const query = new URL(request.url).searchParams;
    await ensureAiStorage();
    if (request.method !== "GET") assertOrigin(request);
    if (kind === "captures") {
      if (!id && request.method === "GET") {
        const runIds = z.array(z.string().min(1).max(160)).max(30).parse((query.get("runIds") ?? "").split(",").filter(Boolean));
        return json(await listChartCaptures(runIds));
      }
      if (id && action === "claim" && request.method === "POST") return json(await claimChartCapture(id));
      if (id && request.method === "POST") {
        const input = z.object({ lease: z.string().uuid(), dataUrl: z.string().optional(), failed: z.boolean().optional(), heartbeat: z.boolean().optional() }).strict().parse(await readBody(request, 6 * 1024 * 1024));
        return json(await finishChartCapture(id, input.lease, input));
      }
    }
    if (kind === "assistant-plan" && request.method === "POST") return json(await prepareAssistant(assistantPlanRequest.parse(await readBody(request)), request.signal));
    if (kind === "page-context" && request.method === "GET") {
      const session = await prisma.replaySession.findUnique({ where: { id: query.get("sessionId") ?? "" }, select: { dataset: { select: { id: true, startTime: true, timezone: true } } } });
      if (!session) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
      return json(session);
    }
    if (kind === "settings") {
      if (request.method === "GET") {
        const config = await readSettings(); return json({ value: publicSettings(config.value), version: config.version, defaults: DEFAULT_PROMPTS });
      }
      const body = z.object({ value: z.unknown(), version: z.number().int().min(0) }).parse(await readBody(request));
      return json(await saveSettings(body.value, body.version));
    }
    if (kind === "endpoint-action" && request.method === "POST") {
      const input = z.object({ id: z.string(), action: z.enum(["models", "test"]), model: z.string().trim().max(160).default("") }).parse(await readBody(request));
      const config = await readSettings(), endpoint = config.value.endpoints.find((e) => e.id === input.id);
      if (!endpoint) throw new AiError("ENDPOINT", copy.ai.unconfigured);
      if (input.action === "models") {
        const data = await boundedJson(await fetch(endpointUrls(endpoint).models, { redirect: "error", headers: requestHeaders(endpoint), signal: AbortSignal.timeout(30000) }));
        return json({ models: [...new Set(z.array(z.object({ id: z.string().trim().min(1).max(160) })).max(2000).parse(data.data).map((m) => m.id))].slice(0, 100) });
      }
      if (!input.model) throw new AiError("MODEL_REQUIRED", copy.ai.modelRequired);
      try { await testConnection(endpoint, input.model); return json({ status: "CONNECTED" }); }
      catch (error) { return json({ status: "FAILED", message: error instanceof AiError ? error.message : copy.ai.connectionFailed }); }
    }
    if (kind === "options" && request.method === "GET") {
      const sessions = await prisma.replaySession.findMany({ where: { activeProjectionId: { not: null } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, name: true, activeProjectionId: true, mode: true, dataset: { select: { id: true, symbol: true, startTime: true, timezone: true } } } });
      const session = sessions.find((s) => s.id === query.get("sessionId"));
      const entries = session ? await prisma.replayJournalEntry.findMany({ where: { projectionId: session.activeProjectionId }, orderBy: { no: "asc" }, take: LIMITS.contextEntries, select: { id: true, no: true, openedAt: true, closedAt: true, review: true } }) : [];
      const templates = await prisma.replayReviewTemplate.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, content: true } });
      return json({ sessions, entries, templates });
    }
    if (kind === "contexts") {
      if (request.method === "POST") return json(await createContext(contextRequestSchema.parse(await readBody(request))));
      if (id && action === "assets") {
        const assets = await prisma.aiAsset.findMany({ where: { contextId: id, chartHash: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true, chartHash: true } });
        return json([...new Map(assets.reverse().map((asset) => [asset.chartHash, asset])).values()]);
      }
      if (id) return json({ id, ...await readContext(id) });
    }
    if (kind === "assets") {
      if (request.method === "POST") {
        const input = z.object({ dataUrl: z.string(), contextId: z.string().optional(), chartHash: z.string().optional() }).strict().parse(await readBody(request, 6 * 1024 * 1024));
        return json(await saveAsset(input.dataUrl, input.contextId, input.chartHash));
      }
      if (id) {
        const asset = await readAsset(id);
        const extension = asset.mime === "image/jpeg" ? "jpg" : asset.mime === "image/webp" ? "webp" : "png";
        return new Response(new Uint8Array(asset.bytes), { headers: { "Content-Type": asset.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
          ...(query.get("download") === "1" ? { "Content-Disposition": `attachment; filename="chart-${id}.${extension}"` } : {}) } });
      }
    }
    if (kind === "conversations") {
      await recoverRuns();
      if (request.method === "GET" && !id) return json(await prisma.aiConversation.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 30, ...(query.get("cursor") ? { cursor: { id: query.get("cursor")! }, skip: 1 } : {}) }));
      if (request.method === "POST" && !id) return json(await retrySqliteWrite(() => prisma.aiConversation.create({ data: { name: copy.ai.newChat } })));
      if (!id) throw new AiError("INVALID", copy.ai.invalid);
      const conversation = await prisma.aiConversation.findUnique({ where: { id } });
      if (!conversation) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
      if (request.method === "GET") {
        const messages = await prisma.aiMessage.findMany({
          where: { conversationId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30,
          ...(query.get("cursor") ? { cursor: { id: query.get("cursor")! }, skip: 1 } : {}),
        });
        const runs = await prisma.aiRun.findMany({ where: { id: { in: messages.flatMap((m) => m.runId ? [m.runId] : []) } }, select: { id: true, snapshot: true, task: true, calls: true, usage: true } });
        const calls = await prisma.aiToolCall.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, orderBy: [{ stepNo: "asc" }, { toolIndex: "asc" }], select: { runId: true, toolCallId: true, name: true, status: true, stepNo: true, toolIndex: true, errorCode: true } });
        const images = await loadDisplayedImages(runs.map((r) => r.id));
        return json({ conversation, messages: messages.map((message) => {
          const run = runs.find((r) => r.id === message.runId), snapshot = run ? JSON.parse(run.snapshot) : null;
          return { ...message, reference: snapshot ? snapshot.endpoint.name + " · " + snapshot.model + " · " + (snapshot.reference ?? "") : "",
            response: message.role === "assistant" ? snapshot?.response ?? null : null,
            images: message.role === "assistant" && message.runId ? images.get(message.runId) ?? [] : [],
            budget: message.role === "assistant" && run ? budgetView(run, calls.filter((c) => c.runId === run.id).length) : undefined,
            reads: message.role === "assistant" ? calls.filter((c) => c.runId === message.runId).map((c) => ({ ...c, eventNo: c.stepNo * 10 + c.toolIndex * 2 + 2 })) : [] };
        }) });
      }
      if (request.method === "PATCH") {
        const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(await readBody(request));
        return json(await retrySqliteWrite(() => prisma.aiConversation.update({ where: { id }, data: body })));
      }
      if (request.method === "DELETE" || action === "clear") {
        if (conversation.activeRunId) await cancelRun(conversation.activeRunId);
        await sqliteWriteTransaction(prisma, async (tx) => {
          const latest = await tx.aiConversation.findUnique({ where: { id } });
          if (latest?.activeRunId) await tx.aiRun.updateMany({ where: { id: latest.activeRunId, status: { in: ["RUNNING", "QUEUED"] } }, data: { status: "CANCELLED", error: copy.ai.stopped } });
          if (action === "clear") {
            await tx.aiConversation.update({ where: { id }, data: { activeRunId: null } });
            await tx.aiMessage.deleteMany({ where: { conversationId: id } });
          } else await tx.aiConversation.delete({ where: { id } });
        });
        return json({ ok: true });
      }
    }
    if (kind === "runs") {
      if (request.method === "POST" && !id) {
        const run = await createRun(runRequestSchema.parse(await readBody(request)));
        if (run.task === "sessionReview" && run.status === "QUEUED") startAnalysisWorker(run.id);
        return json({ id: run.id, status: run.status, task: run.task });
      }
      if (!id) throw new AiError("INVALID", copy.ai.invalid);
      const run = await prisma.aiRun.findUnique({ where: { id } });
      if (!run) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
      if (request.method === "POST" && action === "retry") {
        const input = z.object({ limits: limitsOverrideSchema.optional() }).strict().parse(request.body ? await readBody(request) : {});
        const retry = await retryRun(id, input.limits);
        if (retry.task === "sessionReview") startAnalysisWorker(retry.id);
        return json({ id: retry.id, task: retry.task });
      }
      if (action === "stream" && request.method === "GET") {
        if (run.task === "sessionReview") throw new AiError("INVALID", copy.ai.invalid);
        let ended = false;
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          start(controller) {
            const emit = (event: unknown) => { if (!ended) try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch { ended = true; } };
            void executeRun(id, emit, request.signal).finally(() => { if (!ended) { ended = true; controller.close(); } });
          },
          cancel() { ended = true; void cancelRun(id); },
        }), { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
      }
      if (request.method === "POST" && action === "resume") {
        const input = z.object({ limits: limitsOverrideSchema.optional() }).strict().parse(request.body ? await readBody(request) : {});
        await resumeRun(id, input.limits); startAnalysisWorker(id); return json({ ok: true });
      }
      if (request.method === "DELETE") { await cancelRun(id); return json({ ok: true }); }
      await recoverRuns();
      const fresh = await prisma.aiRun.findUniqueOrThrow({ where: { id } }), snap = JSON.parse(fresh.snapshot);
      const calls = await prisma.aiToolCall.findMany({ where: { runId: id }, orderBy: [{ stepNo: "asc" }, { toolIndex: "asc" }], select: { toolCallId: true, name: true, status: true, stepNo: true, toolIndex: true, errorCode: true } });
      const images = (await loadDisplayedImages([id])).get(id) ?? [];
      return json({ id, task: fresh.task, status: fresh.status, contextId: fresh.contextId, error: fresh.error, calls: fresh.calls,
        totalCalls: fresh.calls + (snap.routing && !snap.routing.reused ? 1 : 0),
        completedBatches: JSON.parse(fresh.checkpoint).filter((p: { stage?: string }) => !p.stage).length, usage: JSON.parse(fresh.usage), estimatedChars: snap.estimatedChars,
        endpoint: snap.endpoint.name, model: snap.model, reference: snap.reference, response: snap.response ?? null, images,
        budget: budgetView(fresh, calls.length),
        reads: calls.map((c) => ({ ...c, eventNo: c.stepNo * 10 + c.toolIndex * 2 + 2 })),
      });
    }
    if (kind === "reports" && request.method === "GET") {
      if (!id) return json(await prisma.aiAnalysis.findMany({ where: query.get("sessionId") ? { replaySessionId: query.get("sessionId")! } : {}, orderBy: { createdAt: "desc" }, take: 30 }));
      const report = await prisma.aiAnalysis.findUnique({ where: { id } });
      if (!report) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
      const stale = await isContextStale(await readContext(report.contextId));
      return json({ ...report, stale });
    }
    if (kind === "adopt" && id && request.method === "POST") {
      const message = await prisma.aiMessage.findUnique({ where: { id } });
      if (!message?.result || !message.contextId || message.status !== "COMPLETED") throw new AiError("INVALID", copy.ai.invalid);
      const context = await readContext(message.contextId); await checkCurrentContext(context);
      const result = JSON.parse(message.result);
      const sourceRun = message.runId ? await prisma.aiRun.findUnique({ where: { id: message.runId } }) : null;
      if (!sourceRun || sourceRun.status !== "COMPLETED") throw new AiError("INVALID", copy.ai.invalid);
      if (typeof result.draft !== "string" || !context.selectedEntryId) throw new AiError("INVALID", copy.ai.invalid);
      const entry = await prisma.replayJournalEntry.findFirst({ where: { id: context.selectedEntryId, projectionId: context.projectionId }, include: { setupOption: { select: { name: true } }, tradeReasons: { select: { id: true, name: true } } } });
      if (!entry || entry.review !== context.entries[0].review || reviewFactsHash(entry) !== reviewFactsHash(context.entries[0])) throw new AiError("CONFLICT", copy.ai.conflict, 409);
      return json({ entryId: entry.id, projectionId: context.projectionId, replaySessionId: context.replaySessionId,
        originalDraft: context.originalDraft ?? entry.review, draft: result.draft, sourceRunId: message.runId });
    }
    throw new AiError("NOT_FOUND", copy.ai.missing, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return aiError(new AiError("INVALID", copy.ai.invalid));
    return aiError(error);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
