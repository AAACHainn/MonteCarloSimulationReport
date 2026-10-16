import { sessionMetrics } from "./statistics";
export { sessionMetrics } from "./statistics";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { readExportWindow, planExportWindow } from "@/lib/market-replay/export-window";
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
import { displayIntervalOptions } from "@/lib/market-replay/display-interval";
import { parseSourceInterval } from "@/lib/market-replay/types";
import { defaultChartPreferences } from "./chart-contract";
import type { PdfChartPreferences } from "@/lib/paper-trading/pdf-types";
import type { StatisticInput } from "./statistics-v1";
import { entryLotId, isFifoRowExit } from "@/lib/paper-trading/journal-identity";

export const hashValue = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type ContextEntry = ReplayJournalEntryData & { sourceId: string; logicalKey: string; href: string; reviewOrigin: string; reviewSourceRunId?: string | null; disciplineStatus?: "PRESENT" | "NOT_RECORDED" | "CORRUPT"; disciplineContentHash?: string };
export type ContextChart = { hash: string; sourceId: string; entryId: string; window: PdfWindow; intervalSeconds?: number; preferencesHash?: string; variantRef?: string; sourceTimes?: Record<string, string> };
export type ChartPlan = { entryId: string; intervalSeconds: number; fromSequence: number; endSequence: number; historyAvailable: number };
export async function chartSourceTimes(datasetId: string, window: PdfWindow) {
  const rows = await prisma.marketBar.findMany({ where: { datasetId, sequence: { in: [...new Set(window.bars.flatMap((b) => [b.firstSequence, b.lastSequence]))] } }, take: 400, select: { sequence: true, timestamp: true } });
  return Object.fromEntries(rows.map((row) => [String(row.sequence), row.timestamp.toISOString()]));
}
export type ContextEvent = { sourceId: string; cycleKey: string | null; sequence: number; kind: string; value: unknown; ordinal?: number; exactLogicalKeys?: string[] };
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
  chartPlans?: ChartPlan[]; chartPreferences?: PdfChartPreferences;
  statisticInput?: StatisticInput;
};
export async function createContext(input: z.infer<typeof contextRequestSchema>) {
  if (input.draft !== undefined && Array.from(input.draft).length > 2000) throw new AiError("DRAFT_TOO_LONG", copy.ai.draftTooLong);
  await ensureAiStorage();
  const fixed = await prisma.$transaction(async (tx) => {
    const session = await tx.replaySession.findUnique({ where: { id: input.replaySessionId }, include: { dataset: true, activeProjection: true, progress: true } });
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
    if (input.entryId && !entries.length) throw new AiError("NOT_FOUND", copy.ai.missing, 404);
    const template = input.templateId ? await tx.replayReviewTemplate.findUnique({ where: { id: input.templateId }, select: { id: true, name: true, content: true } }) : null;
    if (input.templateId && !template) throw new AiError("TEMPLATE_NOT_FOUND", copy.ai.missing);
    const trades = await tx.paperTrade.findMany({ where: { session: { projectionId: session.activeProjectionId }, openedSequence: { lte: session.activeProjection.currentSequence } }, orderBy: [{ closedSequence: "asc" }, { id: "asc" }], take: 10001, select: { id: true, closedSequence: true, grossPnl: true, fees: true, plannedRisk: true, status: true } });
    if (trades.length > 10000) throw new AiError("SCOPE_LIMIT", copy.ai.tooLarge);
    const account = await tx.paperTradingSession.findUnique({ where: { projectionId: session.activeProjectionId }, select: { currency: true } });
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
    const lots = await tx.paperPositionLot.findMany({ where: { session: { projectionId: session.activeProjectionId }, id: { in: entries.map((e) => e.lotId) } }, select: { id: true, entryFillId: true } });
    return { session, entries, template, trades, origins, cutoff, fills, commands, orderCycles, lots, account, protectiveOrders };
  });
  const dataset = fixed.session.dataset;
  const selected = fixed.entries[0];
  const displaySeconds = selected?.displayIntervalSeconds ?? fixed.session.progress?.displayIntervalSeconds ?? dataset.sourceIntervalSeconds!;
  const displaySession = (selected?.displaySession ?? fixed.session.progress?.displaySession) === "RTH" ? "RTH" : "ETH";
  const serialized = serializeMarketDataset({ ...dataset, progress: null });
  const tradingSession = resolveDisplaySession(serialized, displaySession) ?? resolveDisplaySession(serialized, "ETH");
  if (!tradingSession || !dataset.sourceIntervalSeconds || displaySeconds < dataset.sourceIntervalSeconds || displaySeconds % dataset.sourceIntervalSeconds)
    throw new AiError("INTERVAL", copy.ai.invalid);
  const entries: ContextEntry[] = fixed.entries.map((entry) => {
    const key = entry.logicalKey ?? logicalId(entry.id);
    const origin = fixed.origins.find((r) => r.logicalKey === key && r.content === entry.review);
    let disciplineStatus: ContextEntry["disciplineStatus"] = entry.discipline ? "PRESENT" : "NOT_RECORDED";
    try {
      if (entry.discipline) {
        const d = JSON.parse(entry.discipline);
        if (!d || typeof d.strategyId !== "string" || typeof d.strategyName !== "string" || !Number.isInteger(d.checklistVersion) || !Array.isArray(d.checklist)
          || d.checklist.some((item: { id?: unknown; text?: unknown }) => !item || typeof item.id !== "string" || typeof item.text !== "string") || typeof d.confirmedAt !== "string") disciplineStatus = "CORRUPT";
      }
    } catch { disciplineStatus = "CORRUPT"; }
    return { ...serializeReplayJournalEntry({ ...entry, discipline: disciplineStatus === "PRESENT" ? entry.discipline : null }), sourceId: "trade:" + hashValue(key).slice(0, 16), logicalKey: key,
      href: replayJournalTradeHref(dataset.id, entry.journalSessionId, entry.no),
      reviewOrigin: origin?.sourceRunId ? "AI_ASSISTED_USER_SAVED" : "USER_OR_LEGACY", reviewSourceRunId: origin?.sourceRunId ?? null, disciplineStatus,
      disciplineContentHash: hashValue(entry.discipline ? disciplineStatus === "CORRUPT" ? { corrupt: entry.discipline } : JSON.parse(entry.discipline) : null),
    };
  });
  const charts: ContextChart[] = [];
  const chartPlans: ChartPlan[] = [];
  const chartPreferences = input.chartPreferences ?? defaultChartPreferences(selected?.displayUtcOffsetMinutes ?? 0);
  const lotFillById = new Map(fixed.lots.map((lot) => [lot.id, lot.entryFillId]));
  const events: ContextEvent[] = fixed.fills.map((fill) => ({
    sourceId: "fill:" + hashValue(logicalId(fill.id)).slice(0, 16), cycleKey: fill.cycleKey,
    sequence: fill.sequence, kind: "FILL", exactLogicalKeys: entries.filter((e) => lotFillById.get(e.lotId) === fill.id
      || (logicalId(e.lotId) === entryLotId(logicalId(fill.id)) && e.openedSequence === fill.sequence && e.entryPrice === fill.price && fill.openedQuantity >= e.quantity)
      || (isFifoRowExit(e.logicalKey, logicalId(fill.id), logicalId(e.lotId)) && e.closedSequence === fill.sequence && e.exitPrice === fill.price && fill.closedQuantity >= e.quantity)).map((e) => e.logicalKey), value: { timestamp: fill.timestamp.toISOString(), side: fill.side, price: fill.price,
      quantity: fill.quantity, fee: fill.fee, realizedPnl: fill.realizedPnl, closedQuantity: fill.closedQuantity, openedQuantity: fill.openedQuantity, reason: fill.reason },
  }));
  const eventById = new Map(events.map((event) => [event.sourceId, event]));
  const orderKeys = new Map<string, string[]>();
  for (const fill of fixed.fills) {
    const keys = eventById.get("fill:" + hashValue(logicalId(fill.id)).slice(0, 16))?.exactLogicalKeys ?? [];
    orderKeys.set(logicalId(fill.orderId), [...new Set([...(orderKeys.get(logicalId(fill.orderId)) ?? []), ...keys])]);
  }
  for (const order of fixed.protectiveOrders) if (order.parentOrderId) orderKeys.set(logicalId(order.id), orderKeys.get(logicalId(order.parentOrderId)) ?? []);
  for (const command of fixed.commands) {
    let payload: { order?: { id?: string }; orderIds?: string[] };
    try { payload = JSON.parse(command.payload); } catch { continue; }
    if (!payload || typeof payload !== "object") continue;
    if (payload.orderIds && (!Array.isArray(payload.orderIds) || payload.orderIds.some((id) => typeof id !== "string"))) continue;
    if (payload.order?.id !== undefined && typeof payload.order.id !== "string") continue;
    const relatedIds = [payload.order?.id, ...(payload.orderIds ?? [])].filter((id): id is string => Boolean(id && Object.hasOwn(fixed.orderCycles, logicalId(id))));
    const relatedId = relatedIds[0];
    if (relatedId) events.push({ sourceId: "command:" + hashValue(command.id).slice(0, 16), cycleKey: fixed.orderCycles[logicalId(relatedId)] ?? null,
      sequence: command.sourceSequence, ordinal: command.ordinal, kind: command.type,
      exactLogicalKeys: [...new Set(relatedIds.flatMap((id) => orderKeys.get(logicalId(id)) ?? []))],
      value: { order: payload.order ? Object.fromEntries(Object.entries(payload.order).filter(([key]) => ["id", "side", "type", "quantity", "price", "stopLoss", "takeProfit", "reduceOnly"].includes(key))) : null, orderIds: (payload.orderIds ?? []).filter((id) => !input.entryId || orderKeys.get(logicalId(id))?.length) } });
  }
  if (input.entryId || input.depth === "full") {
    for (const entry of entries) {
      const intervals = displayIntervalOptions(dataset.sourceIntervalSeconds, entry.displayIntervalSeconds);
      for (const intervalSeconds of intervals) {
        const before = await planExportWindow({ datasetId: dataset.id, sourceSeconds: dataset.sourceIntervalSeconds, displaySeconds: intervalSeconds, session: tradingSession, endSequence: entry.closedSequence,
          anchorSequence: entry.openedSequence, count: 51, budget: { rows: 25000, queries: 3000 } });
        chartPlans.push({ entryId: entry.id, intervalSeconds, fromSequence: before.fromSequence, endSequence: entry.closedSequence, historyAvailable: Math.max(0, before.count - 1) });
      }
      const initialIntervals = input.timeframes?.map(parseSourceInterval) ?? [entry.displayIntervalSeconds];
      if (initialIntervals.some((s) => s === null || !intervals.includes(s))) throw new AiError("UNSUPPORTED_TIMEFRAME", copy.ai.invalid);
      for (const initialSeconds of [...new Set(initialIntervals)] as number[]) {
      const base = { datasetId: dataset.id, sourceSeconds: dataset.sourceIntervalSeconds, displaySeconds: initialSeconds, session: tradingSession, endSequence: entry.closedSequence, finalSequence: dataset.barCount - 1 };
      let anchor = chartPlans.find((p) => p.entryId === entry.id && p.intervalSeconds === initialSeconds)!.fromSequence;
      while (anchor <= entry.closedSequence) {
        if (charts.length >= LIMITS.chartsPerContext) throw new AiError("CHART_LIMIT", copy.ai.tooLarge);
        const window = await readExportWindow({ ...base, anchorSequence: anchor, direction: "forward", count: Math.floor(80 / initialIntervals.length), warmupCount: chartPreferences.emaEnabled ? Math.min(1000, Math.max(0, ...chartPreferences.emaIndicators.map((e) => e.length * 3))) : 0 });
        if (!window.bars.length) break;
        const preferencesHash = hashValue(chartPreferences);
        const hash = hashValue({ entryId: entry.id, displaySeconds: initialSeconds, displaySession, window, preferencesHash, rendererVersion: 1 });
        charts.push({ hash, sourceId: "chart:" + hash, entryId: entry.id, window, intervalSeconds: initialSeconds, preferencesHash, variantRef: "variant:" + hash, sourceTimes: await chartSourceTimes(dataset.id, window) });
        const last = window.bars.at(-1)!.lastSequence;
        if (last >= entry.closedSequence || window.nextSequence === null) break;
        anchor = last + 1;
      }
      }
    }
  }
  const current = await prisma.replaySession.findUnique({ where: { id: fixed.session.id }, include: { dataset: { select: { historyVersion: true, dataVersion: true } } } });
  if (!current || current.activeProjectionId !== input.projectionId || current.dataset.historyVersion !== dataset.historyVersion || current.dataset.dataVersion !== dataset.dataVersion)
    throw new AiError("CONTEXT_CONFLICT", copy.ai.conflict, 409);
  const value: ContextValue = {
    schemaVersion: 1, capturedAt: new Date().toISOString(), mode: "review",
    replaySessionId: fixed.session.id, projectionId: input.projectionId, sessionName: fixed.session.name,
    historyVersion: dataset.historyVersion, dataVersion: dataset.dataVersion,
    endSequence: input.entryId ? selected.closedSequence : fixed.session.activeProjection!.currentSequence,
    asOfTime: new Date((input.entryId ? selected.closedAt : fixed.cutoff?.timestamp ?? fixed.entries.at(-1)?.closedAt ?? dataset.startTime).getTime() + dataset.sourceIntervalSeconds * 1000).toISOString(),
    sourceSeconds: dataset.sourceIntervalSeconds, datasetId: dataset.id, symbol: dataset.symbol, timezone: dataset.timezone, tick: dataset.priceTickSize,
    selectedEntryId: input.entryId, originalDraft: input.draft, depth: input.depth,
    template: fixed.template, entries, charts, events, metrics: sessionMetrics(fixed.trades, entries),
    sourceHash: hashValue(entries.map((e) => [e.logicalKey, e.review, e.setupOptionId, e.tradeReasons])),
    display: { displayIntervalSeconds: displaySeconds, displaySession, session: tradingSession },
    chartPlans, chartPreferences,
    ...(!input.entryId && fixed.account ? { statisticInput: { specVersion: "1" as const, currency: fixed.account.currency, endSequence: fixed.session.activeProjection!.currentSequence,
      trades: fixed.trades.map((t) => ({ ...t, status: t.status as "CLOSED" | "OPEN" })) } } : {}),
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
