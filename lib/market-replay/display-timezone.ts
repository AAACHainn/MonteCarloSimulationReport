export const UTC_OFFSET_OPTIONS = [
  -600, -540, -480, -420, -360, -300, -240, -180, -120, -60,
  0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600,
] as const;

type TimestampValue = string | number | Date;

type UtcDateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function isSupportedUtcOffsetMinutes(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && (UTC_OFFSET_OPTIONS as readonly number[]).includes(value);
}

export function formatUtcOffset(offsetMinutes: number) {
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function utcDateParts(value: TimestampValue, offsetMinutes: number): UtcDateParts {
  const shifted = new Date(new Date(value).getTime() + offsetMinutes * 60_000);
  return {
    year: String(shifted.getUTCFullYear()),
    month: pad(shifted.getUTCMonth() + 1),
    day: pad(shifted.getUTCDate()),
    hour: pad(shifted.getUTCHours()),
    minute: pad(shifted.getUTCMinutes()),
    second: pad(shifted.getUTCSeconds()),
  };
}

export function formatUtcDateTime(value: TimestampValue, offsetMinutes: number) {
  const parts = utcDateParts(value, offsetMinutes);
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function utcOffsetMinutesForTimezone(value: TimestampValue, timezone: string) {
  try {
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) return 0;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(timestamp).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const offset = Math.round((localAsUtc - timestamp.getTime()) / 60_000);
    if (isSupportedUtcOffsetMinutes(offset)) return offset;
    return UTC_OFFSET_OPTIONS.reduce((nearest, candidate) => (
      Math.abs(candidate - offset) < Math.abs(nearest - offset) ? candidate : nearest
    ), 0);
  } catch {
    return 0;
  }
}
