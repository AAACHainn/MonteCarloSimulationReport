import { tradingDayBounds, tradingDayForTimestamp } from "./chunks";
import {
  BAR_COUNT_INTERVAL_MAX,
  BAR_COUNT_INTERVAL_MIN,
  BAR_COUNT_RECENT_TRADING_DAYS_MAX,
  BAR_COUNT_RECENT_TRADING_DAYS_MIN,
  type AggregatedMarketBarData,
  type BarCountIndicatorConfig,
  type DisplaySession,
  type TradingSessionConfig,
} from "./types";

const HOUR_MS = 60 * 60 * 1_000;
const FIVE_MINUTES_SECONDS = 5 * 60;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const DEFAULT_BAR_COUNT_CONFIG: BarCountIndicatorConfig = {
  enabled: true,
  interval: 1,
  recentTradingDays: 2,
  regularColor: "#64748B",
  bar18Color: "#DC2626",
  hourCloseColor: "#2563EB",
};

export type BarCountLabelKind = "REGULAR" | "BAR_18" | "HOUR_CLOSE";

export type BarCountLabel = {
  index: number;
  number: number;
  kind: BarCountLabelKind;
  color: string;
};

type BarCountInput = {
  bars: AggregatedMarketBarData[];
  displaySession: DisplaySession;
  displayIntervalSeconds: number;
  session: TradingSessionConfig;
  config: BarCountIndicatorConfig;
};

export function isValidBarCountInterval(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= BAR_COUNT_INTERVAL_MIN
    && Number(value) <= BAR_COUNT_INTERVAL_MAX;
}

export function isValidBarCountRecentTradingDays(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= BAR_COUNT_RECENT_TRADING_DAYS_MIN
    && Number(value) <= BAR_COUNT_RECENT_TRADING_DAYS_MAX;
}

/** Find the first loaded candle belonging to the configured recent trading-day window. */
export function barCountWindowStartIndex(
  bars: AggregatedMarketBarData[],
  session: TradingSessionConfig,
  recentTradingDays: number,
) {
  if (!bars.length || !isValidBarCountRecentTradingDays(recentTradingDays)) return bars.length;
  let lastTradingDay: string | null = null;
  let tradingDayCount = 0;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const timestamp = Date.parse(bars[index].timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const tradingDay = tradingDayForTimestamp(timestamp, session);
    if (tradingDay !== lastTradingDay) {
      tradingDayCount += 1;
      if (tradingDayCount > recentTradingDays) return index + 1;
      lastTradingDay = tradingDay;
    }
  }
  return 0;
}

export function canDisplayBarCount({
  displaySession,
  displayIntervalSeconds,
  session,
  config,
}: Omit<BarCountInput, "bars">) {
  return config.enabled
    && displaySession === "RTH"
    && displayIntervalSeconds <= 3_600
    && session.mode === "DAILY_SESSION"
    && isValidBarCountInterval(config.interval)
    && isValidBarCountRecentTradingDays(config.recentTradingDays);
}

export function parseBarCountPreferences(value: string | null): BarCountIndicatorConfig {
  try {
    const parsed = JSON.parse(value ?? "null") as Partial<BarCountIndicatorConfig> | null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_BAR_COUNT_CONFIG };
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_BAR_COUNT_CONFIG.enabled,
      interval: isValidBarCountInterval(parsed.interval) ? parsed.interval : DEFAULT_BAR_COUNT_CONFIG.interval,
      recentTradingDays: isValidBarCountRecentTradingDays(parsed.recentTradingDays)
        ? parsed.recentTradingDays : DEFAULT_BAR_COUNT_CONFIG.recentTradingDays,
      regularColor: typeof parsed.regularColor === "string" && HEX_COLOR.test(parsed.regularColor)
        ? parsed.regularColor.toUpperCase() : DEFAULT_BAR_COUNT_CONFIG.regularColor,
      bar18Color: typeof parsed.bar18Color === "string" && HEX_COLOR.test(parsed.bar18Color)
        ? parsed.bar18Color.toUpperCase() : DEFAULT_BAR_COUNT_CONFIG.bar18Color,
      hourCloseColor: typeof parsed.hourCloseColor === "string" && HEX_COLOR.test(parsed.hourCloseColor)
        ? parsed.hourCloseColor.toUpperCase() : DEFAULT_BAR_COUNT_CONFIG.hourCloseColor,
    };
  } catch {
    return { ...DEFAULT_BAR_COUNT_CONFIG };
  }
}

export function buildBarCountLabels(input: BarCountInput): BarCountLabel[] {
  const { bars, displayIntervalSeconds, session, config } = input;
  if (!canDisplayBarCount(input)) return [];

  const intervalMs = displayIntervalSeconds * 1_000;
  const boundsByDay = new Map<string, { start: number; end: number }>();
  const labels: BarCountLabel[] = [];

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const start = Date.parse(bar.timestamp);
    const end = Date.parse(bar.bucketEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const tradingDay = tradingDayForTimestamp(start, session);
    let bounds = boundsByDay.get(tradingDay);
    if (!bounds) {
      bounds = tradingDayBounds(tradingDay, session);
      boundsByDay.set(tradingDay, bounds);
    }
    const elapsed = start - bounds.start;
    if (elapsed < 0 || start >= bounds.end || elapsed % intervalMs !== 0) continue;

    const number = Math.floor(elapsed / intervalMs) + 1;
    const isBar18 = displayIntervalSeconds === FIVE_MINUTES_SECONDS && number === 18;
    const isHourClose = end > bounds.start && end <= bounds.end && (end - bounds.start) % HOUR_MS === 0;
    const displayStep = config.interval + 1;
    if (number % displayStep !== 0 && number !== 1 && !isBar18 && !isHourClose) continue;

    const kind: BarCountLabelKind = isBar18 ? "BAR_18" : isHourClose ? "HOUR_CLOSE" : "REGULAR";
    labels.push({
      index,
      number,
      kind,
      color: kind === "BAR_18"
        ? config.bar18Color
        : kind === "HOUR_CLOSE"
          ? config.hourCloseColor
          : config.regularColor,
    });
  }

  return labels;
}

export function buildBarCountLabelWindow(input: BarCountInput) {
  if (!canDisplayBarCount(input)) {
    return { startIndex: input.bars.length, labels: [] as BarCountLabel[] };
  }
  const startIndex = barCountWindowStartIndex(input.bars, input.session, input.config.recentTradingDays);
  const labels = buildBarCountLabels({ ...input, bars: input.bars.slice(startIndex) })
    .map((label) => ({ ...label, index: label.index + startIndex }));
  return { startIndex, labels };
}
