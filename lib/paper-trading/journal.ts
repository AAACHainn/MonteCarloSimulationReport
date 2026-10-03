import type {
  PaperJournalContext,
  PaperPositionLotData,
  ReplayJournalEntryData,
  ReplayJournalEntryDraft,
  ReplayJournalSummary,
  ReplayTradeAnnotationData,
} from "./types";

const EPSILON = 1e-12;

export function replayJournalResult(gainLoss: number, priceTickSize: number) {
  return Math.abs(gainLoss) <= priceTickSize * 1e-9
    ? "BE" as const : gainLoss > 0 ? "W" as const : "L" as const;
}

export const DEFAULT_PAPER_JOURNAL_CONTEXT: PaperJournalContext = {
  abrValue: null,
  abrLength: 8,
  displayIntervalSeconds: 1,
  displaySession: "ETH",
  displayUtcOffsetMinutes: 0,
  priceTickSize: 0.01,
};

export function calculateReplayJournalSummary(
  entries: ReadonlyArray<{ gainLoss: number; priceTickSize: number }>,
): ReplayJournalSummary {
  let winningTrades = 0;
  let losingTrades = 0;
  let breakEvenTrades = 0;
  let totalProfitPoints = 0;
  let totalLossPoints = 0;

  for (const entry of entries) {
    const result = replayJournalResult(entry.gainLoss, entry.priceTickSize);
    if (result === "W") {
      winningTrades += 1;
      totalProfitPoints += entry.gainLoss;
    } else if (result === "L") {
      losingTrades += 1;
      totalLossPoints += Math.abs(entry.gainLoss);
    } else {
      breakEvenTrades += 1;
    }
  }

  return {
    tradeCount: entries.length,
    winningTradeCount: winningTrades,
    losingTradeCount: losingTrades,
    breakEvenTradeCount: breakEvenTrades,
    winRate: entries.length === 0 ? 0 : (winningTrades / entries.length) * 100,
    totalProfitPoints,
    totalLossPoints,
    actualProfitLossRatio: totalLossPoints > EPSILON ? totalProfitPoints / totalLossPoints : null,
  };
}

export function calculateReplayJournalTrainingStats(
  entries: ReadonlyArray<{ gainLoss: number; priceTickSize: number; quantity: number }>,
) {
  const summary = calculateReplayJournalSummary(entries);
  let cumulativePoints = 0;
  let cumulativePnl = 0;
  let totalWinningPnl = 0;
  let totalLosingPnl = 0;
  let winStreak = 0;
  let lossStreak = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  const points = [{ tradeNumber: 0, cumulativePoints: 0 }];
  const pnlCurve = [{ tradeNumber: 0, cumulativePnl: 0 }];

  for (const [index, entry] of entries.entries()) {
    const result = replayJournalResult(entry.gainLoss, entry.priceTickSize);
    const pnl = entry.gainLoss * entry.quantity;
    if (result === "W") {
      totalWinningPnl += pnl;
      winStreak += 1;
      lossStreak = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, winStreak);
    } else if (result === "L") {
      totalLosingPnl += pnl;
      lossStreak += 1;
      winStreak = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, lossStreak);
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
    cumulativePoints += entry.gainLoss;
    points.push({ tradeNumber: index + 1, cumulativePoints });
    cumulativePnl += pnl;
    pnlCurve.push({ tradeNumber: index + 1, cumulativePnl });
  }

  const stride = Math.max(1, Math.ceil(points.length / 2_000));
  return {
    ...summary,
    averageWin: summary.winningTradeCount ? totalWinningPnl / summary.winningTradeCount : 0,
    averageLoss: summary.losingTradeCount ? totalLosingPnl / summary.losingTradeCount : 0,
    pnlCurve: pnlCurve.filter((_point, index) => index % stride === 0 || index === pnlCurve.length - 1),
    averageWinPoints: summary.winningTradeCount ? summary.totalProfitPoints / summary.winningTradeCount : 0,
    averageLossPoints: summary.losingTradeCount ? -summary.totalLossPoints / summary.losingTradeCount : 0,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    points: points.filter((_point, index) => index % stride === 0 || index === points.length - 1),
  };
}

export function updateLotAdverseRisk(lots: PaperPositionLotData[], price: number) {
  for (const lot of lots) {
    const adverse = lot.side === "LONG" ? lot.entryPrice - price : price - lot.entryPrice;
    lot.actualRisk = Math.max(lot.actualRisk, adverse, 0);
  }
}

export function closeLotsFifo(
  lots: PaperPositionLotData[],
  quantity: number,
  exit: { fillId: string; sequence: number; timestamp: string; price: number },
) {
  let remaining = quantity;
  const entries: ReplayJournalEntryDraft[] = [];
  for (const lot of lots) {
    if (remaining <= EPSILON || lot.remainingQuantity <= EPSILON) continue;
    const matched = Math.min(remaining, lot.remainingQuantity);
    const initialRisk = lot.initialRisk ?? lot.actualRisk;
    const gainLoss = lot.side === "LONG" ? exit.price - lot.entryPrice : lot.entryPrice - exit.price;
    entries.push({
      id: `journal_${exit.fillId}_${lot.id}_${entries.length}`,
      lotId: lot.id,
      direction: lot.side,
      quantity: matched,
      openedSequence: lot.openedSequence,
      openedAt: lot.openedAt,
      closedSequence: exit.sequence,
      closedAt: exit.timestamp,
      entryPrice: lot.entryPrice,
      entryOrderType: lot.entryOrderType,
      exitPrice: exit.price,
      initialStopPrice: lot.initialStopPrice,
      initialRisk,
      actualRisk: lot.actualRisk,
      gainLoss,
      abrValue: lot.abrValue,
      abrLength: lot.abrLength,
      displayIntervalSeconds: lot.displayIntervalSeconds,
      displaySession: lot.displaySession,
      displayUtcOffsetMinutes: lot.displayUtcOffsetMinutes,
      priceTickSize: lot.priceTickSize,
    });
    lot.remainingQuantity -= matched;
    remaining -= matched;
  }
  return { lots: lots.filter((lot) => lot.remainingQuantity > EPSILON), entries, unmatchedQuantity: remaining };
}

export function serializeReplayJournalEntry(entry: {
  id: string; no: number; accountNo: number; journalSessionId: string; direction: string; quantity: number;
  openedSequence: number; openedAt: Date; closedSequence: number; closedAt: Date;
  entryPrice: number; entryOrderType: string | null; exitPrice: number; initialStopPrice: number | null; abrValue: number | null; abrLength: number;
  displayIntervalSeconds: number; displaySession: string; displayUtcOffsetMinutes: number;
  priceTickSize: number; initialRisk: number; actualRisk: number; gainLoss: number; lotId: string;
  setupOptionId?: string | null; setupOption?: { name: string } | null;
  tradeReasons?: { id: string; name: string }[];
  review?: string;
  journalSession: { archivedAt: Date | null };
}): ReplayJournalEntryData {
  const abr = entry.abrValue !== null && entry.abrValue > 0 ? entry.abrValue : null;
  const effectiveActualRisk = entry.actualRisk > EPSILON ? entry.actualRisk : entry.priceTickSize;
  const effectiveInitialRisk = entry.initialRisk > EPSILON ? entry.initialRisk : entry.priceTickSize;
  const result = replayJournalResult(entry.gainLoss, entry.priceTickSize);
  return {
    id: entry.id, no: entry.accountNo, globalNo: entry.no, journalSessionId: entry.journalSessionId,
    setupOptionId: entry.setupOptionId ?? null,
    setupOption: entry.setupOption ? { name: entry.setupOption.name } : null,
    tradeReasons: entry.tradeReasons?.map((reason) => ({ id: reason.id, name: reason.name })) ?? [],
    review: entry.review ?? "",
    lotId: entry.lotId, direction: entry.direction as "LONG" | "SHORT", quantity: entry.quantity,
    openedSequence: entry.openedSequence, openedAt: entry.openedAt.toISOString(),
    closedSequence: entry.closedSequence, closedAt: entry.closedAt.toISOString(),
    entryPrice: entry.entryPrice,
    entryOrderType: entry.entryOrderType as ReplayJournalEntryData["entryOrderType"],
    exitPrice: entry.exitPrice, initialStopPrice: entry.initialStopPrice,
    abrValue: entry.abrValue, abrLength: entry.abrLength,
    displayIntervalSeconds: entry.displayIntervalSeconds,
    displaySession: entry.displaySession as "ETH" | "RTH",
    displayUtcOffsetMinutes: entry.displayUtcOffsetMinutes,
    priceTickSize: entry.priceTickSize, initialRisk: entry.initialRisk,
    actualRisk: entry.actualRisk, gainLoss: entry.gainLoss, result,
    initialRiskAbr: abr === null ? null : entry.initialRisk / abr,
    actualRiskAbr: abr === null ? null : entry.actualRisk / abr,
    actualInitialRiskRatio: entry.initialRisk > EPSILON ? entry.actualRisk / entry.initialRisk : null,
    abrRr: abr === null ? null : entry.gainLoss / abr,
    initialRiskRr: entry.gainLoss / effectiveInitialRisk,
    actualRiskRr: entry.gainLoss / effectiveActualRisk,
    archivedAt: entry.journalSession.archivedAt?.toISOString() ?? null,
  };
}

export function serializeReplayTradeAnnotation(entry: {
  id: string;
  accountNo: number;
  direction: string;
  entryOrderType: string | null;
  openedSequence: number;
  closedSequence: number;
  entryPrice: number;
  initialStopPrice: number | null;
  actualRisk: number;
  exitPrice: number;
  gainLoss: number;
  priceTickSize: number;
}): ReplayTradeAnnotationData {
  return {
    id: entry.id,
    no: entry.accountNo,
    direction: entry.direction as ReplayTradeAnnotationData["direction"],
    entryOrderType: entry.entryOrderType as ReplayTradeAnnotationData["entryOrderType"],
    openedSequence: entry.openedSequence,
    closedSequence: entry.closedSequence,
    entryPrice: entry.entryPrice,
    initialStopPrice: entry.initialStopPrice,
    actualRisk: entry.actualRisk,
    exitPrice: entry.exitPrice,
    result: replayJournalResult(entry.gainLoss, entry.priceTickSize),
  };
}
