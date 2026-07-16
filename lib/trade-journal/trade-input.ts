import { calculateJournalTrade } from "./calculations";
import { validateStrategyCode } from "./strategy-code";

export type ParsedJournalTradeInput = {
  date: Date;
  instrumentOptionId: string;
  strategyOptionId: string;
  entryPrice: number;
  stopLossPrice: number;
  riskAmount: number;
  targetPrice: number;
  exitPrice: number;
  strategyCode: string | null;
};

function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("请填写完整的交易记录。");
  }
  return value.trim();
}

function requiredNumber(formData: FormData, key: string) {
  const value = Number(requiredString(formData, key));
  if (!Number.isFinite(value)) {
    throw new Error("交易价格和风险额必须是有效数字。");
  }
  return value;
}

export function parseJournalTradeFormData(formData: FormData): ParsedJournalTradeInput {
  const dateValue = requiredString(formData, "date");
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateValue) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateValue
  ) {
    throw new Error("请选择有效的交易日期。");
  }

  const strategyCodeValidation = validateStrategyCode(formData.get("strategyCode"));
  if (!strategyCodeValidation.valid) {
    throw new Error(strategyCodeValidation.error);
  }

  const input = {
    date,
    instrumentOptionId: requiredString(formData, "instrumentOptionId"),
    strategyOptionId: requiredString(formData, "strategyOptionId"),
    entryPrice: requiredNumber(formData, "entryPrice"),
    stopLossPrice: requiredNumber(formData, "stopLossPrice"),
    riskAmount: requiredNumber(formData, "riskAmount"),
    targetPrice: requiredNumber(formData, "targetPrice"),
    exitPrice: requiredNumber(formData, "exitPrice"),
    strategyCode: strategyCodeValidation.normalized || null,
  };

  calculateJournalTrade(input);
  return input;
}
