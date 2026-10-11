import { createEmptyReplayJournalFilters } from "./journal-filters";
import { calculateReplayJournalSummary } from "./journal";
import type { ReplayJournalEntryData } from "./types";
import type { PdfSnapshot, PdfChartPreferences } from "./pdf-types";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import { DEFAULT_BAR_COUNT_CONFIG } from "@/lib/market-replay/bar-count";
import { DEFAULT_CANDLESTICK_STYLE } from "@/lib/market-replay/candlestick-style";

export function pdfEntry(no: number, openedSequence: number, closedSequence: number, overrides: Partial<ReplayJournalEntryData> = {}): ReplayJournalEntryData {
  return { id: "entry-" + no, no, globalNo: no + 100, lotId: "lot-" + no, journalSessionId: "session-qa",
    direction: "LONG", quantity: 1, openedSequence, closedSequence, openedAt: new Date(Date.UTC(2026, 8, 8, 13, 30 + openedSequence)).toISOString(), closedAt: new Date(Date.UTC(2026, 8, 8, 13, 30 + closedSequence)).toISOString(),
    entryPrice: 100, exitPrice: 104, entryOrderType: "MARKET", initialStopPrice: 98, initialRisk: 2, actualRisk: 2.5,
    abrValue: 4, abrLength: 8, displayIntervalSeconds: 60, displaySession: "RTH", displayUtcOffsetMinutes: 480, priceTickSize: 0.25,
    gainLoss: 4, result: "W", initialRiskAbr: 0.5, actualRiskAbr: 0.625, actualInitialRiskRatio: 1.25, abrRr: 1, initialRiskRr: 2, actualRiskRr: 1.6,
    setupOptionId: "setup-qa", setupOption: { name: "突破练习" }, tradeReasons: [{ id: "reason-qa", name: "顺势突破" }], review: "等待确认，按计划离场。", archivedAt: null, ...overrides };
}
export function pdfBars(count: number, stride = 1): AggregatedMarketBarData[] {
  return Array.from({ length: count }, (_, i) => {
    const t = Date.UTC(2026, 8, 8, 13, 30 + i);
    const mid = 100 + Math.sin(i / 5) * 3;
    return { timestamp: new Date(t).toISOString(), bucketEnd: new Date(t + 60000).toISOString(), firstSequence: i * stride, lastSequence: i * stride + stride - 1, open: mid, high: mid + 2, low: mid - 2, close: mid + 0.5, volume: 100 + i, sourceCount: stride, expectedCount: stride, status: "COMPLETE" };
  });
}
export function pdfSnapshot(entries = [pdfEntry(1, 70, 80)]): PdfSnapshot {
  return { session: { id: "session-qa", name: "复盘测试", createdAt: "2026-09-08T00:00:00.000Z", totalCount: entries.length }, capturedAt: "2026-10-11T12:00:00.000Z", endSequence: 999,
    dataset: { id: "dataset-qa", name: "ES", description: null, symbol: "ES", timeframe: "1m", timezone: "America/Chicago", status: "READY", dataVersion: 1, sourceIntervalSeconds: 60, priceTickSize: 0.25, sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: [1,2,3,4,5,6,7], availableDisplaySessions: ["ETH", "RTH"], barCount: 1000, startTime: pdfBars(1)[0].timestamp, endTime: pdfBars(1000).at(-1)!.timestamp, createdAt: "2026-09-08T00:00:00.000Z", progress: null },
    entries, summary: calculateReplayJournalSummary(entries), filters: createEmptyReplayJournalFilters(), filterDescription: "无筛选" };
}
export const pdfPreferences: PdfChartPreferences = { barCountConfig: { ...DEFAULT_BAR_COUNT_CONFIG }, candlestickStyle: DEFAULT_CANDLESTICK_STYLE, emaEnabled: true, emaIndicators: [{ id: "ema-20", length: 20, color: "#f59e0b", lineWidth: 1, lineStyle: "SOLID", visible: true }], gridVisible: true, volumeVisible: true, displayUtcOffsetMinutes: 480 };
