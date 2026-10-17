import { describe, expect, it } from "vitest";
import { calendarDateTimeInput, normalizeDateInput, normalizeTimeInput, splitDateTimeInput, validateDateTimeInput } from "./date-time-input";
import { dateTimeLocalValue, selectedTimeToTimestamp } from "./market-replay/start-time";
import { utcOffsetDateTimeToTimestamp } from "./market-replay/display-timezone";

const minimum = "2021-09-07T08:00:00";
const maximum = "2026-10-05T07:59:00";

describe("shared wall-clock date/time input", () => {
  it.each([
    ["2021-09-07", "2021-09-07"], ["2021/9/7", "2021-09-07"],
    [" 2024-2-29 ", "2024-02-29"], ["0001-1-1", "0001-01-01"], ["2000-2-29", "2000-02-29"],
  ])("normalizes a completed date %s", (raw, normalized) => {
    expect(normalizeDateInput(raw)).toBe(normalized);
  });
  it.each(["", "202", "2021-09-", "2021-02-29", "2024-02-30", "1900-02-29", "2021-13-01", "2021-00-07", "2021-09-00", "2021/09-07", "0000-01-01"])("rejects incomplete or impossible dates %s", (raw) => {
    expect(normalizeDateInput(raw)).toBeNull();
    expect(validateDateTimeInput(`${raw}T08:00:00`, minimum, maximum).error).toBe("date");
  });
  it.each([["8:3", "08:03:00"], ["08:30", "08:30:00"], ["23:59:59", "23:59:59"], ["0:0:1", "00:00:01"]])("normalizes a completed time %s", (raw, normalized) => {
    expect(normalizeTimeInput(raw)).toBe(normalized);
  });
  it.each(["", "08:", "08:30:", "24:00", "08:60", "08:30:60", "-1:30", "08:30Tjunk"])("rejects incomplete or impossible times %s", (raw) => {
    expect(normalizeTimeInput(raw)).toBeNull();
    expect(validateDateTimeInput(`2024-02-29T${raw}`, minimum, maximum).error).toBe("time");
  });
  it("keeps unfinished editing separate from normalization and range validation", () => {
    expect(splitDateTimeInput("202T08:")).toEqual({ date: "202", time: "08:" });
    expect(splitDateTimeInput("2024-02-29T08:30Tjunk").time).toBe("08:30Tjunk");
    expect(validateDateTimeInput("2021-09-07T07:59:59", minimum, maximum)).toEqual({ value: null, error: "range" });
    expect(validateDateTimeInput("2026-10-05T07:59:01", minimum, maximum).error).toBe("range");
    for (const value of [minimum, maximum]) expect(validateDateTimeInput(value, minimum, maximum)).toEqual({ value, error: null });
  });
  it("returns canonical seconds for submission without changing timezone semantics", () => {
    const result = validateDateTimeInput("2024/2/29T8:3", minimum, maximum);
    expect(result).toEqual({ value: "2024-02-29T08:03:00", error: null });
    const instant = selectedTimeToTimestamp(result.value!, "Asia/Shanghai");
    expect(new Date(instant).toISOString()).toBe("2024-02-29T00:03:00.000Z");
    expect(utcOffsetDateTimeToTimestamp(result.value!, 480)).toBe(instant);
    expect(dateTimeLocalValue(new Date(instant).toISOString(), "Asia/Shanghai")).toBe(result.value);
  });
  it("only adjusts boundary times when explicitly selecting a calendar day", () => {
    expect(calendarDateTimeInput("2021-09-07", "2024-02-29T07:30:00", minimum, maximum)).toBe(minimum);
    expect(calendarDateTimeInput("2026-10-05", "2024-02-29T08:00:00", minimum, maximum)).toBe(maximum);
    expect(calendarDateTimeInput("2024-03-01", "2024-02-29T8:30:15", minimum, maximum)).toBe("2024-03-01T08:30:15");
    expect(calendarDateTimeInput("2024-03-01", "2024-02-29T08:", minimum, maximum)).toBe("2024-03-01T08:");
  });
});
