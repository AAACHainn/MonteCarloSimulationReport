import { copy } from "@/lib/i18n";
import type { MarketBarData, TradingSessionConfig } from "./types";
import { DEFAULT_RECTANGLE_STYLE, DEFAULT_TEXT_STYLE, DEFAULT_TREND_LINE_STYLE, type MarketDrawing } from "./chart-drawings";
import type { PaperOrderData, PaperSessionSnapshot, ReplayTradeAnnotationData } from "@/lib/paper-trading/types";

export const PREVIEW_DATASET = { id: "isolated-chart-style", startTime: "2026-11-02T13:30:00.000Z", timezone: "UTC" };
export const PREVIEW_SESSION: TradingSessionConfig = { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [] };
export function previewSourceBars(sequence: number, pulse: number): MarketBarData[] {
  return Array.from({ length: sequence + 1 }, (_, i) => {
    const open = 100 + Math.sin(i / 9) * 3 + i / 70;
    const close = open + Math.sin(i * 1.3) * 0.9 + (i === sequence ? pulse * 0.25 : 0);
    return { sequence: i, timestamp: new Date(Date.parse(PREVIEW_DATASET.startTime) + i * 60_000).toISOString(),
      open, close, high: Math.max(open, close) + 0.6, low: Math.min(open, close) - 0.5, volume: 100 + (i * 19) % 180 };
  }).filter(bar => bar.sequence !== 69);
}
function anchor(sequence: number, price: number) {
  return { timestamp: new Date(Date.parse(PREVIEW_DATASET.startTime) + sequence * 60_000).toISOString(), sourceSequence: sequence, price };
}
export function previewDrawings(): MarketDrawing[] {
  const base = { datasetId: PREVIEW_DATASET.id, createdAt: PREVIEW_DATASET.startTime, updatedAt: PREVIEW_DATASET.startTime };
  return [
    { ...base, id: "preview-trend", type: "TREND_LINE", geometry: { start: anchor(25, 100), end: anchor(95, 102) }, style: { ...DEFAULT_TREND_LINE_STYLE, color: "#F59E0B" } },
    { ...base, id: "preview-rectangle", type: "RECTANGLE", geometry: { start: anchor(45, 98), end: anchor(70, 100) }, style: { ...DEFAULT_RECTANGLE_STYLE, borderStyle: "SOLID" } },
    { ...base, id: "preview-text", type: "TEXT", geometry: { anchor: anchor(85, 105), text: copy.marketReplay.chartPreview.text }, style: { ...DEFAULT_TEXT_STYLE, fontSize: 14 } },
  ];
}
export const PREVIEW_TRADES: ReplayTradeAnnotationData[] = [
  { id: "synthetic-trade", no: 1, direction: "LONG", entryOrderType: "LIMIT", openedSequence: 35, closedSequence: 55,
    entryPrice: 99, exitPrice: 101, initialStopPrice: 97, actualRisk: 2, result: "W" },
];
export function previewAccount(sequence: number, close: number, orders?: PaperOrderData[]): PaperSessionSnapshot {
  const base: PaperOrderData = { id: "preview-order", side: "BUY", type: "LIMIT", status: "PENDING",
    quantity: 1, riskAmount: 50, price: 98, stopLoss: null, takeProfit: null, reduceOnly: false, isProtective: false,
    ocoGroupId: null, createdSequence: 0, activeFromSequence: 1, filledSequence: null, filledAt: null, filledPrice: null, cancelReason: null };
  const activeOrders = orders ?? [base, { ...base, id: "preview-sl", side: "SELL", type: "STOP", price: 96, reduceOnly: true, isProtective: true, ocoGroupId: "synthetic-bracket" },
    { ...base, id: "preview-tp", side: "SELL", price: 108, reduceOnly: true, isProtective: true, ocoGroupId: "synthetic-bracket" }];
  const pnl = close - 100;
  return {
    session: { id: "isolated-account", datasetId: PREVIEW_DATASET.id, initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0,
      lastProcessedSequence: sequence, netQuantity: 1, averageEntryPrice: 100, realizedPnl: 0, totalFees: 0, totalSlippage: 0,
      peakEquity: 10010, maxDrawdown: 0, version: 1 },
    activeOrders, recentOrders: [], recentFills: [], recentTrades: [], openLots: [],
    stats: { balance: 10000, equity: 10000 + pnl, unrealizedPnl: pnl, netPnl: pnl, tradeCount: 0, journalEntryCount: 0,
      winRate: 0, profitFactor: null, averageWin: 0, averageLoss: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
      maxDrawdown: 0, totalFees: 0, totalSlippage: 0 },
  };
}
