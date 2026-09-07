const CME_TIMEZONE = "America/Chicago";
const QUARTER_MONTH_CODES = new Map([
  [3, "H"],
  [6, "M"],
  [9, "U"],
  [12, "Z"],
] as const);

type CalendarDate = { year: number; month: number; day: number };

function chicagoParts(timestamp: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CME_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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
  };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function calendarValue(date: CalendarDate) {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/** CME Globex's next trading day begins at 17:00 America/Chicago. */
export function getCmeTradingDate(timestamp: Date): CalendarDate {
  const parts = chicagoParts(timestamp);
  const date = { year: parts.year, month: parts.month, day: parts.day };
  return parts.hour >= 17 ? addCalendarDays(date, 1) : date;
}

export function getEquityIndexRollDate(year: number, expiryMonth: number): CalendarDate {
  const firstDay = new Date(Date.UTC(year, expiryMonth - 1, 1));
  const firstFriday = 1 + ((5 - firstDay.getUTCDay() + 7) % 7);
  return { year, month: expiryMonth, day: firstFriday + 14 - 4 };
}

export type CmeQuarterlyContract = {
  expiryYear: number;
  expiryMonth: 3 | 6 | 9 | 12;
  monthCode: "H" | "M" | "U" | "Z";
};

/** Resolves the customary lead quarter using CME's Monday-before-third-Friday roll rule. */
export function getCmeQuarterlyLeadContract(timestamp: Date): CmeQuarterlyContract {
  const tradingDate = getCmeTradingDate(timestamp);
  const tradingValue = calendarValue(tradingDate);
  for (let year = tradingDate.year; year <= tradingDate.year + 1; year += 1) {
    for (const expiryMonth of [3, 6, 9, 12] as const) {
      if (tradingValue < calendarValue(getEquityIndexRollDate(year, expiryMonth))) {
        return { expiryYear: year, expiryMonth, monthCode: QUARTER_MONTH_CODES.get(expiryMonth)! };
      }
    }
  }
  throw new Error("Unable to resolve CME quarterly lead contract.");
}

export function isCmeQuarterlyLeadSymbol(symbol: string | undefined, rootSymbol: string, timestamp: Date) {
  const suffix = getCmeQuarterlySymbolSuffix(symbol, rootSymbol);
  if (!suffix) return false;
  const match = /^([HMUZ])(\d{1,2})$/.exec(suffix)!;

  const lead = getCmeQuarterlyLeadContract(timestamp);
  if (match[1] !== lead.monthCode) return false;
  const expectedYear = match[2].length === 1
    ? String(lead.expiryYear % 10)
    : String(lead.expiryYear % 100).padStart(2, "0");
  return match[2] === expectedYear;
}

function getCmeQuarterlySymbolSuffix(symbol: string | undefined, rootSymbol: string) {
  if (!symbol) return null;
  const normalizedRoot = rootSymbol.trim().toUpperCase();
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedRoot || !normalizedSymbol.startsWith(normalizedRoot)) return null;

  const suffix = normalizedSymbol.slice(normalizedRoot.length);
  return /^[HMUZ]\d{1,2}$/.test(suffix) ? suffix : null;
}

export function isCmeQuarterlyOutrightSymbol(symbol: string | undefined, rootSymbol: string) {
  return getCmeQuarterlySymbolSuffix(symbol, rootSymbol) !== null;
}
