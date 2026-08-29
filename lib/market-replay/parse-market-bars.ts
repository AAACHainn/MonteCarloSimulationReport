import { parse } from "csv-parse/sync";
import { tzOffset } from "@date-fns/tz";
import { copy } from "@/lib/i18n";
import { MAX_MARKET_BARS } from "./types";

export type ParsedMarketBar = {
  sequence: number;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type MarketCsvIssue = { row: number; reason: string };

export class MarketCsvValidationError extends Error {
  constructor(public readonly issues: MarketCsvIssue[], public readonly totalIssues = issues.length) {
    super(issues[0]?.reason ?? copy.marketReplay.validation.invalidCsv);
  }
}

type CsvRow = Record<string, string | undefined>;
type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };

const requiredColumns = ["timestamp", "open", "high", "low", "close"] as const;

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function readValue(row: CsvRow, key: string) {
  const found = Object.keys(row).find((candidate) => normalizeKey(candidate) === key);
  return found ? row[found]?.trim() : undefined;
}

function parseFiniteNumber(value: string | undefined) {
  if (!value) return null;
  const number = Number(value.replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function formatParts(timestamp: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(timestamp).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function sameLocalParts(candidate: ReturnType<typeof formatParts>, expected: LocalParts) {
  return candidate.year === expected.year && candidate.month === expected.month && candidate.day === expected.day
    && candidate.hour === expected.hour && candidate.minute === expected.minute && candidate.second === expected.second;
}

function parseLocalIso(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(value);
  if (!match) return null;
  const parts: LocalParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4] ?? 0), minute: Number(match[5] ?? 0), second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "0").padEnd(3, "0")),
  };
  const utcWallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
  const utcCheck = new Date(utcWallTime);
  if (utcCheck.getUTCFullYear() !== parts.year || utcCheck.getUTCMonth() !== parts.month - 1 || utcCheck.getUTCDate() !== parts.day
    || utcCheck.getUTCHours() !== parts.hour || utcCheck.getUTCMinutes() !== parts.minute || utcCheck.getUTCSeconds() !== parts.second) {
    return null;
  }

  const offsets = new Set<number>();
  for (const delta of [-86_400_000, 0, 86_400_000]) offsets.add(tzOffset(timezone, new Date(utcWallTime + delta)));
  const matches = [...offsets]
    .map((offset) => utcWallTime - offset * 60_000)
    .filter((candidate) => sameLocalParts(formatParts(candidate, timezone), parts));
  if (matches.length !== 1) return null;
  return new Date(matches[0]);
}

export function parseMarketTimestamp(value: string | undefined, timezone: string) {
  if (!value) return null;
  if (/^-?\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric)) return null;
    const timestamp = Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return parseLocalIso(value, timezone);
}

export function parseMarketBarsCsv(csv: string, timezone: string): ParsedMarketBar[] {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new MarketCsvValidationError([{ row: 1, reason: copy.marketReplay.validation.invalidTimezone }]);
  }

  let rows: CsvRow[];
  try {
    rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as CsvRow[];
  } catch (error) {
    throw new MarketCsvValidationError([{ row: 1, reason: error instanceof Error ? error.message : copy.marketReplay.validation.csvParseFailed }]);
  }

  if (rows.length < 2) throw new MarketCsvValidationError([{ row: 1, reason: copy.marketReplay.validation.minimumRows }]);
  if (rows.length > MAX_MARKET_BARS) throw new MarketCsvValidationError([{ row: 1, reason: copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS) }]);

  const headers = rows[0] ? Object.keys(rows[0]).map(normalizeKey) : [];
  const missingColumns = requiredColumns.filter((column) => !headers.includes(column));
  if (missingColumns.length) {
    throw new MarketCsvValidationError([{ row: 1, reason: copy.marketReplay.validation.missingColumns(missingColumns.join(", ")) }]);
  }

  const issues: MarketCsvIssue[] = [];
  const bars: ParsedMarketBar[] = [];
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousChartSecond = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const timestamp = parseMarketTimestamp(readValue(row, "timestamp"), timezone);
    const open = parseFiniteNumber(readValue(row, "open"));
    const high = parseFiniteNumber(readValue(row, "high"));
    const low = parseFiniteNumber(readValue(row, "low"));
    const close = parseFiniteNumber(readValue(row, "close"));
    const volumeValue = readValue(row, "volume");
    const volume = volumeValue ? parseFiniteNumber(volumeValue) : null;
    const rowIssues: string[] = [];

    if (!timestamp) rowIssues.push(copy.marketReplay.validation.invalidTimestamp);
    if ([open, high, low, close].some((value) => value === null)) rowIssues.push(copy.marketReplay.validation.invalidOhlc);
    if (volumeValue && (volume === null || volume < 0)) rowIssues.push(copy.marketReplay.validation.invalidVolume);
    if (open !== null && high !== null && low !== null && close !== null
      && (high < Math.max(open, close, low) || low > Math.min(open, close, high))) {
      rowIssues.push(copy.marketReplay.validation.invalidPriceRelation);
    }
    const chartSecond = timestamp ? Math.floor(timestamp.getTime() / 1_000) : Number.NaN;
    if (timestamp && (timestamp.getTime() <= previousTime || chartSecond <= previousChartSecond)) {
      rowIssues.push(copy.marketReplay.validation.invalidOrder);
    }

    if (rowIssues.length) {
      issues.push(...rowIssues.map((reason) => ({ row: rowNumber, reason })));
      return;
    }

    previousTime = timestamp!.getTime();
    previousChartSecond = chartSecond;
    bars.push({ sequence: index, timestamp: timestamp!, open: open!, high: high!, low: low!, close: close!, volume });
  });

  if (issues.length) throw new MarketCsvValidationError(issues.slice(0, 20), issues.length);
  return bars;
}
