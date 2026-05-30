import { describe, expect, it } from "vitest";
import { parseJournalTradeFormData } from "./trade-input";

function validTradeForm() {
  const formData = new FormData();
  for (const [key, value] of Object.entries({
    date: "2026-05-30",
    instrumentOptionId: "instrument",
    strategyOptionId: "strategy",
    entryPrice: "100",
    stopLossPrice: "90",
    riskAmount: "500",
    targetPrice: "120",
    exitPrice: "115",
  })) {
    formData.set(key, value);
  }
  return formData;
}

describe("parseJournalTradeFormData", () => {
  it("parses a valid trade date", () => {
    expect(parseJournalTradeFormData(validTradeForm()).date.toISOString()).toBe("2026-05-30T00:00:00.000Z");
  });

  it("rejects calendar dates that JavaScript would normalize", () => {
    const formData = validTradeForm();
    formData.set("date", "2026-02-31");
    expect(() => parseJournalTradeFormData(formData)).toThrow("请选择有效的交易日期。");
  });
});
