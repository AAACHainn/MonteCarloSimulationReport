import { describe, expect, it } from "vitest";
import {
  getCmeQuarterlyLeadContract,
  getCmeTradingDate,
  getEquityIndexRollDate,
  isCmeQuarterlyLeadSymbol,
} from "./cme-contracts";

describe("CME quarterly equity index contracts", () => {
  it("uses the March quarterly cycle and Monday before the third Friday", () => {
    expect(getEquityIndexRollDate(2021, 3)).toEqual({ year: 2021, month: 3, day: 15 });
    expect(getEquityIndexRollDate(2021, 6)).toEqual({ year: 2021, month: 6, day: 14 });
    expect(getEquityIndexRollDate(2021, 9)).toEqual({ year: 2021, month: 9, day: 13 });
    expect(getEquityIndexRollDate(2021, 12)).toEqual({ year: 2021, month: 12, day: 13 });
  });

  it("advances the CME trading date at 17:00 Chicago across daylight-saving seasons", () => {
    expect(getCmeTradingDate(new Date("2021-09-12T21:59:00Z"))).toEqual({ year: 2021, month: 9, day: 12 });
    expect(getCmeTradingDate(new Date("2021-09-12T22:00:00Z"))).toEqual({ year: 2021, month: 9, day: 13 });
    expect(getCmeTradingDate(new Date("2021-12-12T22:59:00Z"))).toEqual({ year: 2021, month: 12, day: 12 });
    expect(getCmeTradingDate(new Date("2021-12-12T23:00:00Z"))).toEqual({ year: 2021, month: 12, day: 13 });
  });

  it("switches to the next quarterly lead at the Globex open for roll Monday", () => {
    expect(getCmeQuarterlyLeadContract(new Date("2021-09-12T21:59:00Z"))).toMatchObject({ expiryYear: 2021, monthCode: "U" });
    expect(getCmeQuarterlyLeadContract(new Date("2021-09-12T22:00:00Z"))).toMatchObject({ expiryYear: 2021, monthCode: "Z" });
    expect(getCmeQuarterlyLeadContract(new Date("2021-12-12T23:00:00Z"))).toMatchObject({ expiryYear: 2022, monthCode: "H" });
  });

  it("matches exact outright root, quarter code, and one- or two-digit year", () => {
    const september = new Date("2021-09-07T00:00:00Z");
    expect(isCmeQuarterlyLeadSymbol("ESU1", "es", september)).toBe(true);
    expect(isCmeQuarterlyLeadSymbol("ESU21", "ES", september)).toBe(true);
    expect(isCmeQuarterlyLeadSymbol("ESZ1", "ES", september)).toBe(false);
    expect(isCmeQuarterlyLeadSymbol("MESU1", "ES", september)).toBe(false);
    expect(isCmeQuarterlyLeadSymbol("ESU1-ESZ1", "ES", september)).toBe(false);
    expect(isCmeQuarterlyLeadSymbol("ESV1", "ES", september)).toBe(false);
  });
});
