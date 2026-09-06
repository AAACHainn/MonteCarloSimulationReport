import type { PaperOrderData, PaperSessionSnapshot, PaperSide } from "./types";

export type PriceRReference = {
  side: PaperSide;
  entryPrice: number;
  unitRisk: number;
};

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function createBracketRReference(
  side: PaperSide,
  entryPrice: number,
  initialStopPrice: number,
): PriceRReference | null {
  const unitRisk = Math.abs(entryPrice - initialStopPrice);
  if (!isPositiveFinite(entryPrice) || !isPositiveFinite(initialStopPrice) || !isPositiveFinite(unitRisk)) return null;
  if ((side === "BUY" && initialStopPrice >= entryPrice) || (side === "SELL" && initialStopPrice <= entryPrice)) return null;
  return { side, entryPrice, unitRisk };
}

export function rMultipleAtPrice(reference: PriceRReference | null, price: number) {
  if (!reference || !isPositiveFinite(price)) return null;
  const direction = reference.side === "BUY" ? 1 : -1;
  const value = direction * (price - reference.entryPrice) / reference.unitRisk;
  return Object.is(value, -0) ? 0 : value;
}

export function formatRMultiple(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—R";
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized.toFixed(2)}R`;
}

export function protectiveOrderRReference(
  snapshot: PaperSessionSnapshot,
  order: PaperOrderData,
): PriceRReference | null {
  const { averageEntryPrice, netQuantity } = snapshot.session;
  if (!order.isProtective || averageEntryPrice === null || netQuantity === 0) return null;
  const side: PaperSide = netQuantity > 0 ? "BUY" : "SELL";
  const parent = snapshot.recentOrders.find((candidate) => (
    !candidate.isProtective
    && candidate.side === side
    && candidate.filledSequence === order.createdSequence
    && candidate.stopLoss !== null
  ));
  if (parent?.stopLoss !== null && parent?.stopLoss !== undefined) {
    const reference = createBracketRReference(side, averageEntryPrice, parent.stopLoss);
    if (reference) return reference;
  }

  const openTrade = snapshot.recentTrades.find((trade) => trade.status === "OPEN");
  const unitRisk = openTrade?.plannedRisk == null ? null : openTrade.plannedRisk / Math.abs(netQuantity);
  return unitRisk !== null && isPositiveFinite(unitRisk)
    ? { side, entryPrice: averageEntryPrice, unitRisk }
    : null;
}
