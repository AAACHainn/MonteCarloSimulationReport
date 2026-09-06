import { describe, expect, it } from "vitest";
import { addCalendarDays, chunkRequestBounds, chunkRequestDates, tradingDayForTimestamp } from "./chunks";

describe("market replay chunks", () => {
  it("requests one day below five minutes and seven days at five minutes", () => {
    expect(chunkRequestDates("2026-09-06", 1)).toEqual(["2026-09-06"]);
    expect(chunkRequestDates("2026-09-06", 299)).toHaveLength(1);
    expect(chunkRequestDates("2026-09-06", 300)).toEqual([
      "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
      "2026-09-10", "2026-09-11", "2026-09-12",
    ]);
  });

  it("crosses month and leap-day boundaries", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2028-02-28", 2)).toBe("2028-03-01");
  });

  it("uses UTC dates for continuous markets", () => {
    const session = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "Asia/Shanghai", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] };
    expect(tradingDayForTimestamp("2026-09-06T23:59:59.000Z", session)).toBe("2026-09-06");
    const range = chunkRequestBounds("2026-09-06", 1, session);
    expect(new Date(range.start).toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("uses dataset timezone and session boundaries for daily sessions", () => {
    const session = { mode: "DAILY_SESSION" as const, timezone: "America/New_York", openMinute: 570, closeMinute: 960, weekdays: [1,2,3,4,5] };
    expect(tradingDayForTimestamp("2026-07-06T14:00:00.000Z", session)).toBe("2026-07-06");
    const range = chunkRequestBounds("2026-07-06", 60, session);
    expect(new Date(range.start).toISOString()).toBe("2026-07-06T13:30:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-07-06T20:00:00.000Z");
  });
});
