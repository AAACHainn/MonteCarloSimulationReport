import { sqliteWriteTransaction, retrySqliteWrite, SqliteCommitUncertainError } from "@/lib/sqlite-write";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { AiError } from "./errors";
import { hashValue, readContext, type ContextChart } from "./context";
import { prepareChartAsset, discardPreparedChartAsset } from "./assets";
import type { CaptureJob } from "./chart-images-contract";

type CaptureState = { contextId: string; variantId: string; chartHash: string; deadline: number; lease?: string; leaseUntil?: number; assetId?: string; error?: string };
const fail = () => new AiError("CAPTURE_EXPIRED", copy.ai.captureExpired, 409);
const pending = ["REQUESTED", "CAPTURING"];
const sleep = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250);
  signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
});
export async function requestChartImage(runId: string, contextId: string, variantId: string, chart: ContextChart, signal: AbortSignal, notify: () => void, deadline = Date.now() + 90000) {
  signal.throwIfAborted();
  const cached = await prisma.aiAsset.findFirst({ where: { contextId, chartHash: chart.hash }, orderBy: { createdAt: "asc" } });
  if (cached) return cached;
  if (deadline <= Date.now()) throw new AiError("CHART_CAPTURE_TIMEOUT", copy.ai.captureTimeout);
  const requestHash = hashValue({ contextId, variantId, chartHash: chart.hash });
  const task = await sqliteWriteTransaction(prisma, async (tx) => {
    const active = await tx.aiRun.updateMany({ where: { id: runId, contextId, status: "RUNNING" }, data: { heartbeatAt: new Date() } });
    if (!active.count) throw fail();
    const existing = await tx.aiRunStep.findFirst({ where: { runId, phase: "CAPTURE", requestHash } });
    if (existing) return existing;
    if (await tx.aiRunStep.count({ where: { runId, phase: "CAPTURE" } }) >= 100) throw new AiError("CHART_IMAGE_LIMIT", copy.ai.tooLarge);
    const first = await tx.aiRunStep.findFirst({ where: { runId, phase: "CAPTURE" }, orderBy: { stepNo: "asc" } });
    const payload: CaptureState = { contextId, variantId, chartHash: chart.hash, deadline: Math.min(deadline, Date.now() + 90000) };
    return tx.aiRunStep.create({ data: { id: randomUUID(), runId, stepNo: (first?.stepNo ?? 0) - 1, phase: "CAPTURE", status: "REQUESTED", adapterVersion: "browser-image:1", requestHash, payload: JSON.stringify(payload) } });
  });
  notify();
  try {
    while (true) {
      signal.throwIfAborted();
      const current = await prisma.aiRunStep.findUniqueOrThrow({ where: { id: task.id } }), state: CaptureState = JSON.parse(current.payload);
      const run = await prisma.aiRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (run?.status !== "RUNNING") throw fail();
      if (current.status === "READY" && state.assetId) {
        const asset = await prisma.aiAsset.findFirst({ where: { id: state.assetId, contextId, chartHash: chart.hash } });
        if (!asset) throw fail(); return asset;
      }
      if (!pending.includes(current.status)) throw new AiError("CHART_CAPTURE_FAILED", copy.ai.captureFailed);
      if (Date.now() >= state.deadline) {
        await retrySqliteWrite(() => prisma.aiRunStep.updateMany({ where: { id: task.id, status: { in: pending } }, data: { status: "EXPIRED" } }));
        throw new AiError("CHART_CAPTURE_TIMEOUT", copy.ai.captureTimeout);
      }
      await sleep(signal);
    }
  } finally {
    if (signal.aborted) await retrySqliteWrite(() => prisma.aiRunStep.updateMany({ where: { id: task.id, status: { in: pending } }, data: { status: "CANCELLED" } }));
  }
}
export async function listChartCaptures(runIds: string[]) {
  const runs = await prisma.aiRun.findMany({ where: { id: { in: runIds }, status: "RUNNING" }, select: { id: true } });
  const tasks = await prisma.aiRunStep.findMany({ where: { runId: { in: runs.map((r) => r.id) }, phase: "CAPTURE", status: { in: pending } }, orderBy: { createdAt: "asc" }, take: 100 });
  return tasks.filter((t) => { const s: CaptureState = JSON.parse(t.payload); return s.deadline > Date.now() && (t.status === "REQUESTED" || (s.leaseUntil ?? 0) <= Date.now()); }).map((t) => ({ id: t.id, runId: t.runId }));
}
async function lockedTask(tx: Prisma.TransactionClient, id: string) {
  const task = await tx.aiRunStep.findUnique({ where: { id } });
  if (!task || task.phase !== "CAPTURE") throw fail();
  const state: CaptureState = JSON.parse(task.payload);
  const guard = await tx.aiRun.updateMany({ where: { id: task.runId, contextId: state.contextId, status: "RUNNING" }, data: { heartbeatAt: new Date() } });
  if (!guard.count || state.deadline <= Date.now()) throw fail();
  return { task, state };
}
export async function claimChartCapture(id: string): Promise<CaptureJob> {
  const claimed = await sqliteWriteTransaction(prisma, async (tx) => {
    const { task, state } = await lockedTask(tx, id);
    if (!pending.includes(task.status) || (task.status === "CAPTURING" && (state.leaseUntil ?? 0) > Date.now())) throw fail();
    state.lease = randomUUID(); state.leaseUntil = Math.min(state.deadline, Date.now() + 30000);
    await tx.aiRunStep.update({ where: { id }, data: { status: "CAPTURING", payload: JSON.stringify(state) } });
    return state;
  });
  const [context, variant] = await Promise.all([readContext(claimed.contextId), prisma.aiChartVariant.findUniqueOrThrow({ where: { id: claimed.variantId } })]);
  const chart: ContextChart = JSON.parse(variant.value);
  if (variant.contextId !== claimed.contextId || chart.hash !== claimed.chartHash || !chart.window.bars.length || chart.window.bars.some((b) => b.lastSequence > context.endSequence)) throw fail();
  return { id, lease: claimed.lease!, deadline: claimed.deadline, chart,
    context: { id: claimed.contextId, datasetId: context.datasetId, asOfTime: context.asOfTime, timezone: context.timezone, tick: context.tick,
      chartPreferences: context.chartPreferences, display: context.display, currentChart: context.currentChart, endSequence: context.endSequence,
      entries: [] } };
}
export async function finishChartCapture(id: string, lease: string, input: { dataUrl?: string; failed?: boolean; heartbeat?: boolean }) {
  const selected = await sqliteWriteTransaction(prisma, async (tx) => {
    const { task, state } = await lockedTask(tx, id);
    if (state.lease !== lease) throw fail();
    if (task.status === "READY" && state.assetId) return { result: { id: state.assetId } };
    if (task.status !== "CAPTURING" || (state.leaseUntil ?? 0) <= Date.now()) throw fail();
    if (input.heartbeat) {
      state.leaseUntil = Math.min(state.deadline, Date.now() + 30000);
      await tx.aiRunStep.update({ where: { id }, data: { payload: JSON.stringify(state) } }); return { result: { ok: true } };
    }
    if (input.failed) { await tx.aiRunStep.update({ where: { id }, data: { status: "FAILED" } }); return { result: { ok: true } }; }
    if (!input.dataUrl) throw fail();
    return { state };
  });
  if (selected.result) return selected.result;
  const state = selected.state!;
  // File creation happens once, outside all retried database callbacks.
  const prepared = await prepareChartAsset(input.dataUrl!, state.contextId, state.chartHash);
  try {
    const result = await sqliteWriteTransaction(prisma, async (tx) => {
      const current = await lockedTask(tx, id);
      if (current.state.lease !== lease || current.state.contextId !== state.contextId || current.state.chartHash !== state.chartHash) throw fail();
      if (current.task.status === "READY" && current.state.assetId) return { id: current.state.assetId };
      if (current.task.status !== "CAPTURING" || (current.state.leaseUntil ?? 0) <= Date.now()) throw fail();
      await tx.aiAsset.create({ data: prepared });
      current.state.assetId = prepared.id;
      await tx.aiRunStep.update({ where: { id }, data: { status: "READY", payload: JSON.stringify(current.state) } });
      return { id: prepared.id };
    });
    if (result.id !== prepared.id) await discardPreparedChartAsset(prepared);
    return result;
  } catch (error) {
    // An uncertain commit may have published this exact asset. Preserve its file.
    if (!(error instanceof SqliteCommitUncertainError)) await discardPreparedChartAsset(prepared).catch(() => undefined);
    throw error;
  }
}
