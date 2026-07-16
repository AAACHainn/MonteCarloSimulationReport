import { describe, expect, it } from "vitest";
import { parseTradesCsv } from "./parse-trades";

describe("parseTradesCsv", () => {
  it("uses provided rMultiple when present", () => {
    const result = parseTradesCsv("date,symbol,direction,pnl,riskAmount,rMultiple,note\n2024-01-01,ES,LONG,50,100,0.75,manual");

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].rMultiple).toBe(0.75);
    expect(result.rejectedRows).toHaveLength(0);
  });

  it("computes rMultiple from pnl and riskAmount", () => {
    const result = parseTradesCsv("date,symbol,direction,pnl,riskAmount,note\n2024-01-01,NQ,SHORT,-250,100,loss");

    expect(result.trades[0].rMultiple).toBe(-2.5);
  });

  it("rejects rows without usable R data", () => {
    const result = parseTradesCsv("date,symbol,direction,pnl,riskAmount,note\n2024-01-01,NQ,SHORT,,0,bad");

    expect(result.trades).toHaveLength(0);
    expect(result.rejectedRows[0].row).toBe(2);
  });

  it("normalizes an optional strategyCode column", () => {
    const result = parseTradesCsv(
      "date,symbol,direction,rMultiple,strategyCode\n2024-01-01,ES,LONG,1,  qs:a   dn:s  ",
    );

    expect(result.trades[0].strategyCode).toBe("QS:A DN:S");
  });

  it("rejects invalid strategyCode values", () => {
    const result = parseTradesCsv(
      "date,symbol,direction,rMultiple,strategyCode\n2024-01-01,ES,LONG,1,QS:A QS:B",
    );

    expect(result.trades).toHaveLength(0);
    expect(result.rejectedRows[0]).toEqual({ row: 2, reason: "发现重复项目QS。" });
  });
});
