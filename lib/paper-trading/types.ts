import type { MarketBarData } from "@/lib/market-replay/types";

export type PaperSide = "BUY" | "SELL";
export type PaperOrderType = "MARKET" | "LIMIT" | "STOP";
export type PaperOrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
export type PaperFillReason = "ENTRY" | "ADD" | "REDUCE" | "CLOSE" | "REVERSE" | "STOP_LOSS" | "TAKE_PROFIT";

export type PaperAccountConfig = {
  initialCapital: number;
  currency: string;
  commissionBps: number;
  slippageBps: number;
};

export type PaperSessionState = PaperAccountConfig & {
  id: string;
  datasetId: string;
  lastProcessedSequence: number;
  netQuantity: number;
  averageEntryPrice: number | null;
  realizedPnl: number;
  totalFees: number;
  totalSlippage: number;
  peakEquity: number;
  maxDrawdown: number;
  version: number;
};

export type PaperOrderData = {
  id: string;
  side: PaperSide;
  type: PaperOrderType;
  status: PaperOrderStatus;
  quantity: number;
  riskAmount: number | null;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  reduceOnly: boolean;
  isProtective: boolean;
  ocoGroupId: string | null;
  createdSequence: number;
  activeFromSequence: number;
  filledSequence: number | null;
  filledAt: string | null;
  filledPrice: number | null;
  cancelReason: string | null;
  createdAt?: string;
};

export type PaperFillData = {
  id: string;
  orderId: string;
  sequence: number;
  timestamp: string;
  side: PaperSide;
  price: number;
  quantity: number;
  fee: number;
  slippageCost: number;
  realizedPnl: number;
  closedQuantity: number;
  openedQuantity: number;
  netQuantityAfter: number;
  averagePriceAfter: number | null;
  reason: PaperFillReason;
};

export type PaperEquityPointData = {
  sequence: number;
  timestamp: string;
  balance: number;
  equity: number;
  drawdown: number;
};

export type PaperJournalContext = {
  abrValue: number | null;
  abrLength: number;
  displayIntervalSeconds: number;
  displaySession: "ETH" | "RTH";
  displayUtcOffsetMinutes: number;
  priceTickSize: number;
};

export type PaperPositionLotData = PaperJournalContext & {
  id: string;
  entryFillId: string;
  side: "LONG" | "SHORT";
  openedSequence: number;
  openedAt: string;
  entryPrice: number;
  entryOrderType: PaperOrderType | null;
  initialStopPrice: number | null;
  initialQuantity: number;
  remainingQuantity: number;
  initialRisk: number | null;
  actualRisk: number;
};

export type ReplayJournalEntryDraft = PaperJournalContext & {
  id: string;
  lotId: string;
  direction: "LONG" | "SHORT";
  quantity: number;
  openedSequence: number;
  openedAt: string;
  closedSequence: number;
  closedAt: string;
  entryPrice: number;
  entryOrderType: PaperOrderType | null;
  exitPrice: number;
  initialStopPrice: number | null;
  initialRisk: number;
  actualRisk: number;
  gainLoss: number;
};

export type ReplayJournalEntryData = ReplayJournalEntryDraft & {
  no: number;
  globalNo: number;
  setupOptionId: string | null;
  setupOption: { name: string } | null;
  reasonTags: { id: string; name: string }[];
  result: "W" | "L" | "BE";
  initialRiskAbr: number | null;
  actualRiskAbr: number | null;
  actualInitialRiskRatio: number | null;
  abrRr: number | null;
  initialRiskRr: number;
  actualRiskRr: number;
  journalSessionId: string;
  archivedAt: string | null;
};

export type ReplayTradeAnnotationData = {
  id: string;
  no: number;
  direction: "LONG" | "SHORT";
  entryOrderType: PaperOrderType | null;
  openedSequence: number;
  closedSequence: number;
  entryPrice: number;
  initialStopPrice: number | null;
  actualRisk: number;
  exitPrice: number;
  result: "W" | "L" | "BE";
};

export type PaperTradeData = {
  id: string;
  side: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  openedSequence: number;
  openedAt: string;
  closedSequence: number | null;
  closedAt: string | null;
  grossPnl: number;
  fees: number;
  plannedRisk: number | null;
};

export type PaperTradingStats = {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  netPnl: number;
  tradeCount: number;
  winRate: number;
  profitFactor: number | null;
  averageWin: number;
  averageLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  maxDrawdown: number;
  totalFees: number;
  totalSlippage: number;
};

export type PaperSessionSnapshot = {
  session: PaperSessionState;
  activeOrders: PaperOrderData[];
  recentOrders: PaperOrderData[];
  recentFills: PaperFillData[];
  recentTrades: PaperTradeData[];
  openLots?: PaperPositionLotData[];
  stats: PaperTradingStats;
};

export type PaperAdvanceResult = {
  state: PaperSessionState;
  orders: PaperOrderData[];
  fills: PaperFillData[];
  equityPoint: PaperEquityPointData;
  lots: PaperPositionLotData[];
  journalEntries: ReplayJournalEntryDraft[];
};

export type PaperAdvanceInput = {
  state: PaperSessionState;
  orders: PaperOrderData[];
  bar: MarketBarData;
  makeId: () => string;
  lots?: PaperPositionLotData[];
  journalContext?: PaperJournalContext | null;
};
