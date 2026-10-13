import { tzOffset } from "@date-fns/tz";
import type { SyncSchedule } from "./types";

const formatters = new Map<string, Intl.DateTimeFormat>();
export function localParts(date: Date, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); formatters.set(timezone, formatter); }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute };
}
export function budgetDay(date: Date, timezone: string) {
  const p = localParts(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
function localInstant(civil: number, timezone: string) {
  const offsets = new Set([-2, -1, 0, 1, 2].map((days) => tzOffset(timezone, new Date(civil + days * 86400000))));
  const candidates = [...offsets].map((offset) => civil - offset * 60000).sort((a, b) => a - b);
  const civilAt = (instant: number) => { const p = localParts(new Date(instant), timezone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); };
  for (const candidate of candidates) if (civilAt(candidate) === civil) return new Date(candidate);
  // Nonexistent local time: choose the first valid civil minute after the gap.
  let selected = candidates.at(-1)!; let best = Number.POSITIVE_INFINITY;
  for (let instant = candidates[0]; instant <= candidates.at(-1)!; instant += 60000) {
    const value = civilAt(instant);
    if (value >= civil && value < best) { selected = instant; best = value; }
  }
  return new Date(selected);
}
export function nextScheduledAt(schedule: SyncSchedule, after: Date): Date {
  const anchor = new Date(schedule.anchor);
  if (schedule.unit === "MINUTE" || schedule.unit === "HOUR") {
    const step = schedule.every * (schedule.unit === "MINUTE" ? 60000 : 3600000);
    return new Date(anchor.getTime() + Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / step) + 1) * step);
  }
  const p = localParts(anchor, schedule.timezone);
  const [hour, minute] = schedule.time.split(":").map(Number);
  const base = Date.UTC(p.year, p.month - 1, p.day);
  const current = localParts(after, schedule.timezone);
  const currentCivil = Date.UTC(current.year, current.month - 1, current.day);
  let index = schedule.unit === "MONTH"
    ? Math.max(0, Math.floor(((current.year - p.year) * 12 + current.month - p.month) / schedule.every) - 1)
    : Math.max(0, Math.floor((currentCivil - base) / (86400000 * schedule.every * (schedule.unit === "WEEK" ? 7 : 1))) - 1);
  for (; index < 100000; index++) {
    let civil: number;
    if (schedule.unit === "MONTH") {
      const first = new Date(Date.UTC(p.year, p.month - 1 + index * schedule.every, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      civil = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), schedule.monthEnd ? last : Math.min(last, schedule.monthDay), hour, minute);
    } else {
      const shift = schedule.unit === "WEEK" ? (schedule.weekday - new Date(base).getUTCDay() + 7) % 7 : 0;
      civil = base + (shift + index * schedule.every * (schedule.unit === "WEEK" ? 7 : 1)) * 86400000 + hour * 3600000 + minute * 60000;
    }
    const instant = localInstant(civil, schedule.timezone);
    if (instant > after && instant >= anchor) return instant;
  }
  throw new Error("Schedule exceeds supported date range");
}
