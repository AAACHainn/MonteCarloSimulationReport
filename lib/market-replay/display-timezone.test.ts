import { describe, expect, it } from "vitest";
import {
  UTC_OFFSET_OPTIONS,
  formatUtcDateTime,
  formatUtcOffset,
  isSupportedUtcOffsetMinutes,
  utcDateParts,
  utcOffsetMinutesForTimezone,
} from "./display-timezone";

describe("market replay display timezone", () => {
  it.each([
    [0, "UTC"],
    [480, "UTC+08:00"],
    [-330, "UTC-05:30"],
    [600, "UTC+10:00"],
  ])("formats the UTC offset %s", (offset, label) => {
    expect(formatUtcOffset(offset)).toBe(label);
  });

  it("formats one timestamp without depending on the machine timezone", () => {
    const timestamp = "2026-09-05T12:34:56.000Z";
    expect(formatUtcDateTime(timestamp, 0)).toBe("2026/09/05 12:34:56");
    expect(formatUtcDateTime(timestamp, 480)).toBe("2026/09/05 20:34:56");
    expect(formatUtcDateTime(timestamp, -300)).toBe("2026/09/05 07:34:56");
    expect(utcDateParts(timestamp, 600)).toMatchObject({ hour: "22", minute: "34", day: "05" });
  });

  it("derives an initial fixed UTC offset from an imported IANA timezone", () => {
    expect(utcOffsetMinutesForTimezone("2026-09-05T00:00:00.000Z", "Asia/Shanghai")).toBe(480);
    expect(utcOffsetMinutesForTimezone("2026-01-15T12:00:00.000Z", "America/New_York")).toBe(-300);
    expect(utcOffsetMinutesForTimezone("2026-07-15T12:00:00.000Z", "America/New_York")).toBe(-240);
  });

  it("falls back to UTC for invalid timezone data and exposes supported offsets", () => {
    expect(utcOffsetMinutesForTimezone("invalid", "Asia/Shanghai")).toBe(0);
    expect(utcOffsetMinutesForTimezone("2026-09-05T00:00:00.000Z", "Invalid/Timezone")).toBe(0);
    expect(isSupportedUtcOffsetMinutes(480)).toBe(true);
    expect(isSupportedUtcOffsetMinutes(17)).toBe(false);
    expect(isSupportedUtcOffsetMinutes(345)).toBe(false);
    expect(UTC_OFFSET_OPTIONS).toContain(0);
    expect(UTC_OFFSET_OPTIONS.at(0)).toBe(-600);
    expect(UTC_OFFSET_OPTIONS.at(-1)).toBe(600);
    expect(UTC_OFFSET_OPTIONS.every((offset) => offset % 60 === 0)).toBe(true);
  });
});
