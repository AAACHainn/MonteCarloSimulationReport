import { describe, expect, it } from "vitest";
import { budgetDay, nextScheduledAt } from "./schedule";
import { defaultSchedule } from "./types";
describe("market sync calendar scheduling", () => {
  it("skips missed fixed intervals without drifting its anchor", () => {
    const schedule = { ...defaultSchedule(), unit: "MINUTE" as const, every: 5, anchor: "2026-01-01T00:00:00Z" };
    expect(nextScheduledAt(schedule, new Date("2026-01-01T00:17:00Z")).toISOString()).toBe("2026-01-01T00:20:00.000Z");
  });
  it("clamps February but returns to the original month day in March", () => {
    const schedule = { ...defaultSchedule(), unit: "MONTH" as const, monthDay: 31, timezone: "UTC", time: "09:00", anchor: "2026-01-01T00:00:00Z" };
    expect(nextScheduledAt(schedule, new Date("2026-01-31T09:00:00Z")).toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(nextScheduledAt(schedule, new Date("2026-02-28T09:00:00Z")).toISOString()).toBe("2026-03-31T09:00:00.000Z");
  });
  it("uses the first valid minute after a DST gap", () => {
    const schedule = { ...defaultSchedule(), timezone: "America/New_York", time: "02:30", anchor: "2026-03-01T00:00:00Z" };
    expect(nextScheduledAt(schedule, new Date("2026-03-08T06:00:00Z")).toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });
  it("does not run again at the second occurrence of a repeated clock time", () => {
    const schedule = { ...defaultSchedule(), timezone: "America/New_York", time: "01:30", anchor: "2026-10-01T00:00:00Z" };
    expect(nextScheduledAt(schedule, new Date("2026-11-01T05:30:00Z")).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
  it("keeps N-week plans aligned with the selected weekday", () => {
    const schedule = { ...defaultSchedule(), unit: "WEEK" as const, every: 2, weekday: 1, timezone: "UTC", anchor: "2026-01-01T00:00:00Z" };
    expect(nextScheduledAt(schedule, new Date("2026-01-05T09:00:00Z")).toISOString()).toBe("2026-01-19T09:00:00.000Z");
  });
  it("resets the budget day in the configured timezone", () => expect(budgetDay(new Date("2026-01-01T16:00:00Z"), "Asia/Shanghai")).toBe("2026-01-02"));
});
