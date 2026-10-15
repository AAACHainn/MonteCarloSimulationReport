import { sessionMetrics } from "./statistics";
export { sessionMetrics } from "./statistics";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { readExportWindow } from "@/lib/market-replay/export-window";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import { serializeReplayJournalEntry } from "@/lib/paper-trading/journal";
import { replayJournalTradeHref } from "@/lib/paper-trading/journal-links";
import { logicalId } from "@/lib/replay-sessions/identity";
import type { PdfWindow } from "@/lib/paper-trading/pdf-types";
import type { ReplayJournalEntryData } from "@/lib/paper-trading/types";
import type { TradingSessionConfig } from "@/lib/market-replay/types";
import { LIMITS, type contextRequestSchema } from "./schema";
import { ensureAiStorage } from "./config";
import { AiError } from "./errors";

export const hashValue = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type ContextEntry = ReplayJournalEntryData & { sourceId: string; logicalKey: string; href: string; reviewOrigin: string };
export type ContextChart = { hash: string; sourceId: string; entryId: string; window: PdfWindow };
export type ContextEvent = { sourceId: string; cycleKey: string | null; sequence: number; kind: string; value: unknown };
export type ContextValue = {
  schemaVersion: 1; capturedAt: string; mode: "review";
  replaySessionId: string; projectionId: string; sessionName: string;
  historyVersion: number; dataVersion: number; endSequence: number; asOfTime: string;
  sourceSeconds: number; datasetId: string; symbol: string; timezone: string; tick: number;
  selectedEntryId?: string; originalDraft?: string; depth: "quick" | "full";
  template: { id: string; name: string; content: string } | null;
  entries: ContextEntry[]; charts: ContextChart[];
  events: ContextEvent[];
  metrics: ReturnType<typeof sessionMetrics>; sourceHash: string;
  display: { displayIntervalSeconds: number; displaySession: "ETH" | "RTH"; session: TradingSessionConfig };
  warnings: string[];
};
export async function createContext(input: z.infer<typeof contextRequestSchema>) {
  await ensureAiStorage();
  const fixed = await prisma.$transaction(async (tx) => {
    const session = await tx.replaySession.findUnique({ where: { id: input.replaySessionId }, include: { dataset: true, activeProjection: true } });
    if (!session?.activeProjection || session.activeProjectionId !== input.projectionId || session.pendingCorrectionId)
      throw new AiError("CONTEXT_CONFLICT", copy.ai.conflict, 409);
    const where = { projectionId: session.activeProjectionId, closedSequence: { lte: session.activeProjection.currentSequence } };
    const count = await tx.replayJournalEntry.count({ where });
    if (count > LIMITS.contextEntries) throw new AiError("SCOPE_LIMIT", copy.ai.tooLarge);
    const entries = await tx.replayJournalEntry.findMany({
      where: { ...where, ...(input.entryId ? { id: input.entryId } : {}) },
      include: { journalSession: { select: { archivedAt: true } }, setupOption: { select: { name: true } }, tradeReasons: { select: { id: true, name: true } } },
      orderBy: [{ closedSequence: "asc" }, { no: "asc" }],
    });
    if (!entries.length) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
    const template = input.templateId ? await tx.replayReviewTemplate.findUnique({ where: { id: input.templateId }, select: { id: true, name: true, content: true } }) : null;
    if (input.templateId && !template) throw new AiError("NOT_FOUND", copy.ai.missing);
    const trades = await tx.paperTrade.findMany({ where: { session: { projectionId: session.activeProjectionId } }, orderBy: [{ closedSequence: "asc" }, { id: "asc" }], select: { grossPnl: true, fees: true, plannedRisk: true, status: true } });
    const origins = await tx.aiReviewRevision.findMany({ where: { replaySessionId: session.id }, orderBy: { createdAt: "desc" }, take: 10000 });
    const cutoff = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: session.datasetId, sequence: session.activeProjection.currentSequence } }, select: { timestamp: true } });
    const endSequence = input.entryId ? entries[0].closedSequence : session.activeProjection.currentSequence;
    const cycleKeys = [...new Set(entries.flatMap((e) => e.cycleKey ? [e.cycleKey] : []))];
    const fills = await tx.paperFill.findMany({
      where: { session: { projectionId: session.activeProjectionId }, cycleKey: { in: cycleKeys }, sequence: { lte: endSequence } },
      orderBy: [{ sequence: "asc" }, { id: "asc" }], take: 20001,
      select: { id: true, orderId: true, cycleKey: true, sequence: true, timestamp: true, side: true, price: true, quantity: true, fee: true, realizedPnl: true, closedQuantity: true, openedQuantity: true, reason: true },
    });
    const commands = fills.length ? await tx.replayCommand.findMany({
      where: { replaySessionId: session.id, projections: { some: { projectionId: session.activeProjectionId } }, sourceSequence: { lte: endSequence }, type: { in: ["ORDER_CREATE", "ORDER_UPDATE", "ORDER_CANCEL"] } },
      orderBy: [{ sourceSequence: "asc" }, { ordinal: "asc" }], take: 20001,
    }) : [];
    const protectiveOrders = fills.length ? await tx.paperOrder.findMany({
      where: { session: { projectionId: session.activeProjectionId }, createdSequence: { lte: endSequence },
        parentOrderId: { in: fills.flatMap((f) => [f.orderId, logicalId(f.orderId)]) } },
      select: { id: true, parentOrderId: true }, take: 20001,
    }) : [];
    if (fills.length > 20000 || commands.length > 20000) throw new AiError("EVENT_LIMIT", copy.ai.tooLarge);
    if (protectiveOrders.length > 20000) throw new AiError("EVENT_LIMIT", copy.ai.tooLarge);
    const orderCycles = Object.fromEntries(fills.map((f) => [logicalId(f.orderId), f.cycleKey]));
    for (const order of protectiveOrders) if (order.parentOrderId) orderCycles[logicalId(order.id)] = orderCycles[logicalId(order.parentOrderId)];
    return { session, entries, template, trades, origins, cutoff, fills, commands, orderCycles };
  });
  const dataset = fixed.session.dataset;
  const selected = fixed.entries[0];
  const displaySeconds = selected.displayIntervalSeconds;
  const displaySession = selected.displaySession === "RTH" ? "RTH" : "ETH";
  const serialized = serializeMarketDataset({ ...dataset, progress: null });
  const tradingSession = resolveDisplaySession(serialized, displaySession) ?? resolveDisplaySession(serialized, "ETH");
  if (!tradingSession || !dataset.sourceIntervalSeconds || displaySeconds < dataset.sourceIntervalSeconds || displaySeconds % dataset.sourceIntervalSeconds)
    throw new AiError("INTERVAL", copy.ai.invalid);
  const entries: ContextEntry[] = fixed.entries.map((entry) => {
    const key = entry.logicalKey ?? logicalId(entry.id);
    const origin = fixed.origins.find((r) => r.logicalKey === key && r.content === entry.review);
    return { ...serializeReplayJournalEntry(entry), sourceId: "trade:" + hashValue(key).slice(0, 16), logicalKey: key,
      href: replayJournalTradeHref(dataset.id, entry.journalSessionId, entry.no),
      reviewOrigin: origin?.sourceRunId ? "AI_ASSISTED_USER_SAVED" : "USER_OR_LEGACY",
    };
  });
  const charts: ContextChart[] = [];
  const events: ContextEvent[] = fixed.fills.map((fill) => ({
    sourceId: "fill:" + hashValue(logicalId(fill.id)).slice(0, 16), cycleKey: fill.cycleKey,
    sequence: fill.sequence, kind: "FILL", value: { timestamp: fill.timestamp.toISOString(), side: fill.side, price: fill.price,
      quantity: fill.quantity, fee: fill.fee, realizedPnl: fill.realizedPnl, closedQuantity: fill.closedQuantity, openedQuantity: fill.openedQuantity, reason: fill.reason },
  }));
  for (const command of fixed.commands) {
    const payload = JSON.parse(command.payload) as { order?: { id?: string }; orderIds?: string[] };
    const relatedId = [payload.order?.id, ...(payload.orderIds ?? [])].find((id) => id && Object.hasOwn(fixed.orderCycles, logicalId(id)));
    if (relatedId) events.push({ sourceId: "command:" + hashValue(command.id).slice(0, 16), cycleKey: fixed.orderCycles[logicalId(relatedId)] ?? null,
      sequence: command.sourceSequence, kind: command.type, value: payload });
  }
  if (input.entryId || input.depth === "full") {
    for (const entry of entries) {
      const base = { datasetId: dataset.id, sourceSeconds: dataset.sourceIntervalSeconds, displaySeconds, session: tradingSession, endSequence: entry.closedSequence, finalSequence: dataset.barCount - 1 };
      const before = await readExportWindow({ ...base, anchorSequence: entry.openedSequence, direction: "backward", count: 51, warmupCount: 0 });
      let anchor = before.bars[0]?.firstSequence ?? entry.openedSequence;
      while (anchor <= entry.closedSequence) {
        if (charts.length >= LIMITS.chartsPerContext) throw new AiError("CHART_LIMIT", copy.ai.tooLarge);
        const window = await readExportWindow({ ...base, anchorSequence: anchor, direction: "forward", count: 200, warmupCount: 0 });
        if (!window.bars.length) break;
        const hash = hashValue({ entryId: entry.id, displaySeconds, displaySession, window });
        charts.push({ hash, sourceId: "chart:" + hash, entryId: entry.id, window });
        const last = window.bars.at(-1)!.lastSequence;
        if (last >= entry.closedSequence || window.nextSequence === null) break;
        anchor = last + 1;
      }
    }
  }
  const current = await prisma.replaySession.findUnique({ where: { id: fixed.session.id }, include: { dataset: { select: { historyVersion: true } } } });
  if (!current || current.activeProjectionId !== input.projectionId || current.dataset.historyVersion !== dataset.historyVersion)
    throw new AiError("CONTEXT_CONFLICT", copy.ai.conflict, 409);
  const value: ContextValue = {
    schemaVersion: 1, capturedAt: new Date().toISOString(), mode: "review",
    replaySessionId: fixed.session.id, projectionId: input.projectionId, sessionName: fixed.session.name,
    historyVersion: dataset.historyVersion, dataVersion: dataset.dataVersion,
    endSequence: input.entryId ? selected.closedSequence : fixed.session.activeProjection!.currentSequence,
    asOfTime: new Date((input.entryId ? selected.closedAt : fixed.cutoff?.timestamp ?? fixed.entries.at(-1)!.closedAt).getTime() + dataset.sourceIntervalSeconds * 1000).toISOString(),
    sourceSeconds: dataset.sourceIntervalSeconds, datasetId: dataset.id, symbol: dataset.symbol, timezone: dataset.timezone, tick: dataset.priceTickSize,
    selectedEntryId: input.entryId, originalDraft: input.draft, depth: input.depth,
    template: fixed.template, entries, charts, events, metrics: sessionMetrics(fixed.trades, entries),
    sourceHash: hashValue(entries.map((e) => [e.logicalKey, e.review, e.setupOptionId, e.tradeReasons])),
    display: { displayIntervalSeconds: displaySeconds, displaySession, session: tradingSession },
    warnings: [copy.ai.noHistory, ...(!events.length ? [copy.ai.noEvents] : []), ...(input.depth === "quick" && !input.entryId ? [copy.ai.noCharts] : [])],
  };
  const row = await prisma.aiContext.create({ data: { value: JSON.stringify(value) } });
  return { id: row.id, ...value };
}
export async function readContext(id: string): Promise<ContextValue> {
  const row = await prisma.aiContext.findUnique({ where: { id } });
  if (!row) throw new AiError("CONTEXT_MISSING", copy.ai.missing, 404);
  return { events: [], ...JSON.parse(row.value) };
}
export async function checkCurrentContext(value: ContextValue) {
  const session = await prisma.replaySession.findUnique({ where: { id: value.replaySessionId }, include: { dataset: { select: { historyVersion: true } } } });
  if (!session || session.activeProjectionId !== value.projectionId || session.pendingCorrectionId || session.dataset.historyVersion !== value.historyVersion)
    throw new AiError("CONTEXT_CONFLICT", copy.ai.conflict, 409);
}
export async function isContextStale(value: ContextValue) {
  try { await checkCurrentContext(value); } catch { return true; }
  const projection = await prisma.replayProjection.findUnique({ where: { id: value.projectionId }, select: { currentSequence: true } });
  if (!value.selectedEntryId && projection?.currentSequence !== value.endSequence) return true;
  const entries = await prisma.replayJournalEntry.findMany({
    where: { projectionId: value.projectionId, ...(value.selectedEntryId ? { id: value.selectedEntryId } : {}) },
    orderBy: [{ closedSequence: "asc" }, { no: "asc" }],
    include: { tradeReasons: { select: { id: true, name: true } } },
  });
  return hashValue(entries.map((e) => [e.logicalKey ?? logicalId(e.id), e.review, e.setupOptionId, e.tradeReasons])) !== value.sourceHash;
}
