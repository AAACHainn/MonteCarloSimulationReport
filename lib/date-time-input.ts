/** Wall-clock input helpers: no browser timezone or instant conversion. */
export function splitDateTimeInput(value: string) {
  const separator = value.indexOf("T");
  return separator < 0 ? { date: value, time: "" }
    : { date: value.slice(0, separator), time: value.slice(separator + 1) };
}

export function normalizeDateInput(value: string): string | null {
  const match = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, , month, day] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (Number(year) < 1 || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function normalizeTimeInput(value: string): string | null {
  const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, hour, minute, second = "00"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  return [hour, minute, second].map((part) => part.padStart(2, "0")).join(":");
}

export function validateDateTimeInput(value: string, minimum: string, maximum: string): {
  value: string | null; error: "date" | "time" | "range" | null;
} {
  const parts = splitDateTimeInput(value);
  const date = normalizeDateInput(parts.date);
  if (!date) return { value: null, error: "date" };
  const time = normalizeTimeInput(parts.time);
  if (!time) return { value: null, error: "time" };
  const normalized = `${date}T${time}`;
  if (normalized < minimum || normalized > maximum) return { value: null, error: "range" };
  return { value: normalized, error: null };
}

/** An explicit calendar selection may adjust the time on a boundary day. Typing never does. */
export function calendarDateTimeInput(date: string, value: string, minimum: string, maximum: string) {
  const { time } = splitDateTimeInput(value);
  const normalizedTime = normalizeTimeInput(time);
  const next = `${date}T${normalizedTime ?? time}`;
  if (!normalizedTime) return next;
  return next < minimum ? minimum : next > maximum ? maximum : next;
}
