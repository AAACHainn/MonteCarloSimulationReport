import { parse } from "csv-parse/sync";
import { tzOffset } from "@date-fns/tz";
import { copy } from "@/lib/i18n";
import { MAX_MARKET_BARS, formatInterval } from "./types";
import { getAggregationBucket } from "./aggregation";
import {
  addCmeDailyVolume,
  buildCmeVolumeLeadMap,
  cmeVolumeDateKey,
  normalizeCmeOutrightSymbol,
  type CmeDailyVolumes,
} from "./cme-contracts";
import type { TradingSessionConfig } from "./types";

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

export type CsvRow = Record<string, string | undefined>;
export type CsvValues = string[];
export type CsvColumnIndexes = Readonly<Record<string, number>>;
export type CsvRecord = CsvRow | CsvValues;
type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };

const standardRequiredColumns = ["timestamp", "open", "high", "low", "close"] as const;
const databentoCmeRequiredColumns = ["ts_event", "rtype", "open", "high", "low", "close", "volume", "symbol"] as const;
export type MarketCsvFormat = "STANDARD" | "DATABENTO_CME";

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

export function inspectMarketCsvHeaders(headers: string[]) {
  const normalizedHeaders = headers.map(normalizeKey);
  const format: MarketCsvFormat = normalizedHeaders.includes("ts_event") ? "DATABENTO_CME" : "STANDARD";
  const requiredColumns = format === "DATABENTO_CME" ? databentoCmeRequiredColumns : standardRequiredColumns;
  return {
    format,
    normalizedHeaders,
    missingColumns: requiredColumns.filter((column) => !normalizedHeaders.includes(column)),
  };
}

export function createCsvColumnIndexes(headers: string[]) {
  return Object.fromEntries(headers.map((header, index) => [normalizeKey(header), index])) as Record<string, number>;
}

export function readCsvValue(row: CsvRecord, key: string, columnIndexes?: CsvColumnIndexes) {
  if (Array.isArray(row)) {
    const index = columnIndexes?.[key];
    return index === undefined ? undefined : row[index]?.trim();
  }
  const found = Object.keys(row).find((candidate) => normalizeKey(candidate) === key);
  return found ? row[found]?.trim() : undefined;
}

export function parseFiniteNumber(value: string | undefined) {
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

export type MarketBarParseOptions = {
  sourceIntervalSeconds: number;
  session: TradingSessionConfig;
  cmeRootSymbol?: string;
  cmeLeadByDate?: ReadonlyMap<string, string>;
};

const DATABENTO_RTYPE_INTERVALS = new Map([
  [32, 1],
  [33, 60],
  [34, 3_600],
  [35, 86_400],
]);

export function databentoSourceIntervalSeconds(row: CsvRecord, columnIndexes?: CsvColumnIndexes) {
  const rtype = Number(readCsvValue(row, "rtype", columnIndexes));
  return DATABENTO_RTYPE_INTERVALS.get(rtype) ?? null;
}

export function isMarketTimestampAligned(timestamp: Date, options: MarketBarParseOptions) {
  return getAggregationBucket(
    timestamp.getTime(), options.sourceIntervalSeconds, options.sourceIntervalSeconds, options.session,
  ) !== null;
}

export function parseMarketCsvRow({
  row, columnIndexes, rowNumber, sequence, timezone, options, previousTime = Number.NEGATIVE_INFINITY,
  previousChartSecond = Number.NEGATIVE_INFINITY, format = "STANDARD",
}: {
  row: CsvRecord; columnIndexes?: CsvColumnIndexes; rowNumber: number; sequence: number; timezone: string; options?: MarketBarParseOptions;
  previousTime?: number; previousChartSecond?: number; format?: MarketCsvFormat;
}) {
  const symbol = readCsvValue(row, "symbol", columnIndexes);
  let cmeSymbol: string | null = null;
  if (format === "DATABENTO_CME") {
    if (!options?.cmeRootSymbol) {
      return {
        issues: [{ row: rowNumber, reason: copy.marketReplay.validation.cmeRootRequired }],
        time: previousTime,
        chartSecond: previousChartSecond,
        bar: null,
        skipped: false,
      };
    }
    const declaredInterval = databentoSourceIntervalSeconds(row, columnIndexes);
    if (declaredInterval === null || declaredInterval !== options.sourceIntervalSeconds) {
      return {
        issues: [{
          row: rowNumber,
          reason: declaredInterval === null
            ? copy.marketReplay.validation.unsupportedDatabentoRtype
            : copy.marketReplay.validation.sourceIntervalMismatch(formatInterval(declaredInterval)),
        }],
        time: previousTime,
        chartSecond: previousChartSecond,
        bar: null,
        skipped: false,
      };
    }
    cmeSymbol = normalizeCmeOutrightSymbol(symbol, options.cmeRootSymbol);
    if (!cmeSymbol) {
      return {
        issues: [],
        time: previousTime,
        chartSecond: previousChartSecond,
        bar: null,
        skipped: true,
      };
    }
  }

  const timestamp = parseMarketTimestamp(readCsvValue(row, format === "DATABENTO_CME" ? "ts_event" : "timestamp", columnIndexes), timezone);
  if (format === "DATABENTO_CME" && !timestamp) {
    return {
      issues: [{ row: rowNumber, reason: copy.marketReplay.validation.invalidTimestamp }],
      time: previousTime,
      chartSecond: previousChartSecond,
      bar: null,
      skipped: false,
    };
  }
  if (format === "DATABENTO_CME" && options!.cmeLeadByDate
    && options!.cmeLeadByDate.get(cmeVolumeDateKey(timestamp!)) !== cmeSymbol) {
    return {
      issues: [],
      time: previousTime,
      chartSecond: previousChartSecond,
      bar: null,
      skipped: true,
    };
  }

  const open = parseFiniteNumber(readCsvValue(row, "open", columnIndexes));
  const high = parseFiniteNumber(readCsvValue(row, "high", columnIndexes));
  const low = parseFiniteNumber(readCsvValue(row, "low", columnIndexes));
  const close = parseFiniteNumber(readCsvValue(row, "close", columnIndexes));
  const volumeValue = readCsvValue(row, "volume", columnIndexes);
  const volume = volumeValue ? parseFiniteNumber(volumeValue) : null;
  const reasons: string[] = [];
  if (!timestamp) reasons.push(copy.marketReplay.validation.invalidTimestamp);
  if ([open, high, low, close].some((value) => value === null)) reasons.push(copy.marketReplay.validation.invalidOhlc);
  if (volumeValue && (volume === null || volume < 0)) reasons.push(copy.marketReplay.validation.invalidVolume);
  if (open !== null && high !== null && low !== null && close !== null
    && (high < Math.max(open, close, low) || low > Math.min(open, close, high))) reasons.push(copy.marketReplay.validation.invalidPriceRelation);
  const chartSecond = timestamp ? Math.floor(timestamp.getTime() / 1_000) : Number.NaN;
  if (timestamp && (timestamp.getTime() <= previousTime || chartSecond <= previousChartSecond)) reasons.push(copy.marketReplay.validation.invalidOrder);
  if (timestamp && options && !isMarketTimestampAligned(timestamp, options)) reasons.push(copy.marketReplay.validation.intervalMisaligned);
  return {
    issues: reasons.map((reason) => ({ row: rowNumber, reason })),
    time: timestamp?.getTime() ?? previousTime, chartSecond,
    bar: reasons.length ? null : { sequence, timestamp: timestamp!, open: open!, high: high!, low: low!, close: close!, volume },
    skipped: false,
  };
}

export function parseMarketBarsCsv(csv: string, timezone: string, options?: MarketBarParseOptions): ParsedMarketBar[] {
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

  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const { format, missingColumns } = inspectMarketCsvHeaders(headers);
  if (missingColumns.length) {
    throw new MarketCsvValidationError([{ row: 1, reason: copy.marketReplay.validation.missingColumns(missingColumns.join(", ")) }]);
  }
  if (format === "STANDARD" && rows.length > MAX_MARKET_BARS) {
    throw new MarketCsvValidationError([{ row: 1, reason: copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS) }]);
  }
  if (format === "DATABENTO_CME" && !options?.cmeRootSymbol) {
    throw new MarketCsvValidationError([{ row: 1, reason: copy.marketReplay.validation.cmeRootRequired }]);
  }

  let resolvedOptions = options;
  if (format === "DATABENTO_CME") {
    const dailyVolumes: CmeDailyVolumes = new Map();
    for (const row of rows) {
      const cmeSymbol = normalizeCmeOutrightSymbol(readCsvValue(row, "symbol"), options!.cmeRootSymbol!);
      const timestamp = parseMarketTimestamp(readCsvValue(row, "ts_event"), timezone);
      const volume = parseFiniteNumber(readCsvValue(row, "volume"));
      if (cmeSymbol && timestamp && volume !== null && volume >= 0) {
        addCmeDailyVolume(dailyVolumes, timestamp, cmeSymbol, volume);
      }
    }
    resolvedOptions = { ...options!, cmeLeadByDate: buildCmeVolumeLeadMap(dailyVolumes) };
  }

  const issues: MarketCsvIssue[] = [];
  const bars: ParsedMarketBar[] = [];
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousChartSecond = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const parsed = parseMarketCsvRow({
      row, rowNumber, sequence: bars.length, timezone, options: resolvedOptions, previousTime, previousChartSecond, format,
    });
    if (parsed.skipped) return;
    if (parsed.issues.length || !parsed.bar) {
      issues.push(...parsed.issues);
      return;
    }
    if (bars.length >= MAX_MARKET_BARS) {
      issues.push({ row: rowNumber, reason: copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS) });
      return;
    }
    previousTime = parsed.time;
    previousChartSecond = parsed.chartSecond;
    bars.push(parsed.bar);
  });

  if (issues.length) throw new MarketCsvValidationError(issues.slice(0, 20), issues.length);
  if (bars.length < 2) {
    throw new MarketCsvValidationError([{
      row: 1,
      reason: format === "DATABENTO_CME" ? copy.marketReplay.validation.minimumCmeBars : copy.marketReplay.validation.minimumRows,
    }]);
  }
  return bars;
}
