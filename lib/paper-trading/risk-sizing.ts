import type { PaperOrderType, PaperSide } from "./types";

export const MAX_PAPER_ORDER_QUANTITY = 1_000_000_000_000;

export type RiskSizingError =
  | "INVALID_PRICE"
  | "INVALID_RISK_AMOUNT"
  | "INVALID_STOP_SIDE"
  | "INVALID_TARGET_SIDE"
  | "INVALID_UNIT_RISK"
  | "QUANTITY_LIMIT";

export type RiskSizingInput = {
  side: PaperSide;
  type: Extract<PaperOrderType, "LIMIT" | "STOP">;
  entryPrice: number;
  stopLoss: number;
  takeProfit?: number | null;
  riskAmount: number;
  commissionBps: number;
  slippageBps: number;
};

export type RiskSizingResult = {
  quantity: number;
  estimatedEntryFill: number;
  estimatedStopFill: number;
  unitRisk: number;
  projectedLoss: number;
  projectedProfit: number | null;
  rewardRiskRatio: number | null;
};

export type RiskSizingOutcome =
  | { ok: true; value: RiskSizingResult }
  | { ok: false; error: RiskSizingError };

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function isValidBracket(
  side: PaperSide,
  entryPrice: number,
  stopLoss: number | null,
  takeProfit: number | null,
) {
  if (!isPositiveFinite(entryPrice)) return false;
  if (side === "BUY") {
    return (stopLoss === null || (isPositiveFinite(stopLoss) && stopLoss < entryPrice))
      && (takeProfit === null || (isPositiveFinite(takeProfit) && takeProfit > entryPrice));
  }
  return (stopLoss === null || (isPositiveFinite(stopLoss) && stopLoss > entryPrice))
    && (takeProfit === null || (isPositiveFinite(takeProfit) && takeProfit < entryPrice));
}

/**
 * Estimates the position size whose stop-out loss, including entry/exit fees and
 * adverse stop slippage, equals the requested absolute risk amount.
 */
export function calculateRiskSizing(input: RiskSizingInput): RiskSizingOutcome {
  const {
    side, type, entryPrice, stopLoss, takeProfit = null, riskAmount,
    commissionBps, slippageBps,
  } = input;
  if (![entryPrice, stopLoss, commissionBps, slippageBps].every(Number.isFinite)
      || entryPrice <= 0 || stopLoss <= 0 || commissionBps < 0 || slippageBps < 0) {
    return { ok: false, error: "INVALID_PRICE" };
  }
  if (!isPositiveFinite(riskAmount)) return { ok: false, error: "INVALID_RISK_AMOUNT" };
  if ((side === "BUY" && stopLoss >= entryPrice) || (side === "SELL" && stopLoss <= entryPrice)) {
    return { ok: false, error: "INVALID_STOP_SIDE" };
  }
  if (takeProfit !== null
      && (!isPositiveFinite(takeProfit)
        || (side === "BUY" && takeProfit <= entryPrice)
        || (side === "SELL" && takeProfit >= entryPrice))) {
    return { ok: false, error: "INVALID_TARGET_SIDE" };
  }

  const feeRate = commissionBps / 10_000;
  const slippageRate = slippageBps / 10_000;
  const entrySlippageFactor = type === "STOP"
    ? side === "BUY" ? 1 + slippageRate : 1 - slippageRate
    : 1;
  const estimatedEntryFill = entryPrice * entrySlippageFactor;
  const estimatedStopFill = stopLoss * (side === "BUY" ? 1 - slippageRate : 1 + slippageRate);
  const grossLossPerUnit = side === "BUY"
    ? estimatedEntryFill - estimatedStopFill
    : estimatedStopFill - estimatedEntryFill;
  const unitRisk = grossLossPerUnit + (estimatedEntryFill + estimatedStopFill) * feeRate;
  if (!isPositiveFinite(unitRisk)) return { ok: false, error: "INVALID_UNIT_RISK" };

  const quantity = riskAmount / unitRisk;
  if (!isPositiveFinite(quantity) || quantity > MAX_PAPER_ORDER_QUANTITY) {
    return { ok: false, error: "QUANTITY_LIMIT" };
  }
  const projectedLoss = quantity * unitRisk;
  let projectedProfit: number | null = null;
  let rewardRiskRatio: number | null = null;
  if (takeProfit !== null) {
    const grossProfitPerUnit = side === "BUY"
      ? takeProfit - estimatedEntryFill
      : estimatedEntryFill - takeProfit;
    const netProfitPerUnit = grossProfitPerUnit - (estimatedEntryFill + takeProfit) * feeRate;
    projectedProfit = quantity * netProfitPerUnit;
    rewardRiskRatio = projectedProfit / projectedLoss;
  }

  return {
    ok: true,
    value: {
      quantity,
      estimatedEntryFill,
      estimatedStopFill,
      unitRisk,
      projectedLoss,
      projectedProfit,
      rewardRiskRatio,
    },
  };
}

export function orderTypeForEntry(side: PaperSide, entryPrice: number, currentPrice: number) {
  if (side === "BUY") return entryPrice <= currentPrice ? "LIMIT" as const : "STOP" as const;
  return entryPrice >= currentPrice ? "LIMIT" as const : "STOP" as const;
}

export function targetPriceForR(side: PaperSide, entryPrice: number, stopLoss: number, targetR: number) {
  const distance = Math.abs(entryPrice - stopLoss) * targetR;
  return side === "BUY" ? entryPrice + distance : entryPrice - distance;
}
