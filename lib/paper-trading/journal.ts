import type {
  PaperJournalContext,
  PaperPositionLotData,
  ReplayJournalEntryData,
  ReplayJournalEntryDraft,
} from "./types";

const EPSILON = 1e-12;

export const DEFAULT_PAPER_JOURNAL_CONTEXT: PaperJournalContext = {
  abrValue: null,
  abrLength: 8,
  displayIntervalSeconds: 1,
  displaySession: "ETH",
  displayUtcOffsetMinutes: 0,
  priceTickSize: 0.01,
};

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
      exitPrice: exit.price,
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
  id: string; no: number; journalSessionId: string; direction: string; quantity: number;
  openedSequence: number; openedAt: Date; closedSequence: number; closedAt: Date;
  entryPrice: number; exitPrice: number; abrValue: number | null; abrLength: number;
  displayIntervalSeconds: number; displaySession: string; displayUtcOffsetMinutes: number;
  priceTickSize: number; initialRisk: number; actualRisk: number; gainLoss: number; lotId: string;
  journalSession: { archivedAt: Date | null };
}): ReplayJournalEntryData {
  const abr = entry.abrValue !== null && entry.abrValue > 0 ? entry.abrValue : null;
  const effectiveActualRisk = entry.actualRisk > EPSILON ? entry.actualRisk : entry.priceTickSize;
  const effectiveInitialRisk = entry.initialRisk > EPSILON ? entry.initialRisk : entry.priceTickSize;
  const result = Math.abs(entry.gainLoss) <= entry.priceTickSize * 1e-9
    ? "BE" as const : entry.gainLoss > 0 ? "W" as const : "L" as const;
  return {
    id: entry.id, no: entry.no, journalSessionId: entry.journalSessionId,
    lotId: entry.lotId, direction: entry.direction as "LONG" | "SHORT", quantity: entry.quantity,
    openedSequence: entry.openedSequence, openedAt: entry.openedAt.toISOString(),
    closedSequence: entry.closedSequence, closedAt: entry.closedAt.toISOString(),
    entryPrice: entry.entryPrice, exitPrice: entry.exitPrice,
    abrValue: entry.abrValue, abrLength: entry.abrLength,
    displayIntervalSeconds: entry.displayIntervalSeconds,
    displaySession: entry.displaySession as "ETH" | "RTH",
    displayUtcOffsetMinutes: entry.displayUtcOffsetMinutes,
    priceTickSize: entry.priceTickSize, initialRisk: entry.initialRisk,
    actualRisk: entry.actualRisk, gainLoss: entry.gainLoss, result,
    initialRiskAbr: abr === null ? null : entry.initialRisk / abr,
    actualRiskAbr: abr === null ? null : entry.actualRisk / abr,
    abrRr: abr === null ? null : entry.gainLoss / abr,
    initialRiskRr: entry.gainLoss / effectiveInitialRisk,
    actualRiskRr: entry.gainLoss / effectiveActualRisk,
    archivedAt: entry.journalSession.archivedAt?.toISOString() ?? null,
  };
}
