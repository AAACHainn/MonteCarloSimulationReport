"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_CANDLESTICK_STYLE,
  parseCandlestickStyle,
  type CandlestickStyle,
} from "@/lib/market-replay/candlestick-style";
import {
  DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
  DEFAULT_TREND_LINE_STYLE,
  parseFibonacciRetracementPreferences,
  parseTrendLinePreferences,
  type FibonacciRetracementStyle,
  type FibonacciRetracementTemplate,
  type TrendLineStyle,
  type TrendLineTemplate,
} from "@/lib/market-replay/chart-drawings";
import {
  isSupportedUtcOffsetMinutes,
  utcOffsetMinutesForTimezone,
} from "@/lib/market-replay/display-timezone";
import {
  DEFAULT_EMA_LINE_STYLE,
  DEFAULT_EMA_LINE_WIDTH,
  normalizeEmaLineStyle,
  normalizeEmaLineWidth,
} from "@/lib/market-replay/ema-style";
import {
  DEFAULT_BAR_COUNT_CONFIG,
  parseBarCountPreferences,
} from "@/lib/market-replay/bar-count";
import {
  ABR_LENGTH_MAX,
  ABR_LENGTH_MIN,
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  MAX_EMA_INDICATORS,
  type EmaIndicatorConfig,
} from "@/lib/market-replay/types";

const EMA_SETTINGS_STORAGE_KEY = "market-replay-ema-settings-v1";
const ABR_SETTINGS_STORAGE_KEY = "market-replay-abr-settings-v1";
const VOLUME_VISIBILITY_STORAGE_KEY = "market-replay-volume-visibility-v1";
const CANDLE_COUNTDOWN_VISIBILITY_STORAGE_KEY = "market-replay-candle-countdown-visibility-v1";
const BAR_COUNT_SETTINGS_STORAGE_KEY = "market-replay-bar-count-settings-v1";
const DISPLAY_TIMEZONE_STORAGE_KEY = "market-replay-display-timezone-v1";
const CANDLESTICK_STYLE_STORAGE_KEY = "market-replay-candlestick-style-v1";
const TREND_LINE_PREFERENCES_STORAGE_KEY = "market-replay-trend-line-preferences-v1";
const FIBONACCI_PREFERENCES_STORAGE_KEY = "market-replay-fibonacci-preferences-v1";

export const EMA_COLORS = ["#f59e0b", "#2563eb", "#7c3aed", "#0f766e", "#e11d48"];
export const DEFAULT_EMA_INDICATORS: EmaIndicatorConfig[] = [
  { id: "ema-default-20", length: 20, color: EMA_COLORS[0], lineWidth: DEFAULT_EMA_LINE_WIDTH, lineStyle: DEFAULT_EMA_LINE_STYLE, visible: true },
  { id: "ema-default-60", length: 60, color: EMA_COLORS[1], lineWidth: DEFAULT_EMA_LINE_WIDTH, lineStyle: DEFAULT_EMA_LINE_STYLE, visible: true },
  { id: "ema-default-200", length: 200, color: EMA_COLORS[2], lineWidth: DEFAULT_EMA_LINE_WIDTH, lineStyle: DEFAULT_EMA_LINE_STYLE, visible: true },
];

function cloneFibonacciStyle(style: FibonacciRetracementStyle): FibonacciRetracementStyle {
  return { ...style, levels: style.levels.map((level) => ({ ...level })) };
}

function isValidEmaLength(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= EMA_LENGTH_MIN && Number(value) <= EMA_LENGTH_MAX;
}

function loadEmaSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EMA_SETTINGS_STORAGE_KEY) ?? "null") as {
      enabled?: unknown;
      indicators?: unknown;
    } | null;
    if (!parsed || typeof parsed.enabled !== "boolean" || !Array.isArray(parsed.indicators)) return null;
    const indicators = parsed.indicators.slice(0, MAX_EMA_INDICATORS).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<EmaIndicatorConfig>;
      if (typeof candidate.id !== "string" || !isValidEmaLength(candidate.length)) return [];
      return [{
        id: candidate.id,
        length: candidate.length,
        color: typeof candidate.color === "string" ? candidate.color : EMA_COLORS[index],
        lineWidth: normalizeEmaLineWidth(candidate.lineWidth),
        lineStyle: normalizeEmaLineStyle(candidate.lineStyle),
        visible: typeof candidate.visible === "boolean" ? candidate.visible : true,
      }];
    });
    return { enabled: parsed.enabled, indicators };
  } catch {
    return null;
  }
}

function loadAbrSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ABR_SETTINGS_STORAGE_KEY) ?? "null") as {
      enabled?: unknown;
      length?: unknown;
    } | null;
    if (!parsed || typeof parsed.enabled !== "boolean" || !Number.isInteger(parsed.length)
      || Number(parsed.length) < ABR_LENGTH_MIN || Number(parsed.length) > ABR_LENGTH_MAX) return null;
    return { enabled: parsed.enabled, length: Number(parsed.length) };
  } catch {
    return null;
  }
}

export function useReplayPreferences(dataset: { id: string; startTime: string; timezone: string }) {
  const [candlestickStyle, setCandlestickStyle] = useState<CandlestickStyle>(DEFAULT_CANDLESTICK_STYLE);
  const [candlestickStyleLoaded, setCandlestickStyleLoaded] = useState(false);
  const [emaEnabled, setEmaEnabled] = useState(false);
  const [emaIndicators, setEmaIndicators] = useState<EmaIndicatorConfig[]>(DEFAULT_EMA_INDICATORS);
  const [emaSettingsLoaded, setEmaSettingsLoaded] = useState(false);
  const [abrEnabled, setAbrEnabled] = useState(false);
  const [abrLength, setAbrLength] = useState(8);
  const [abrSettingsLoaded, setAbrSettingsLoaded] = useState(false);
  const [volumeVisible, setVolumeVisible] = useState(true);
  const [volumeVisibilityLoaded, setVolumeVisibilityLoaded] = useState(false);
  const [candleCountdownEnabled, setCandleCountdownEnabled] = useState(false);
  const [candleCountdownSettingsLoaded, setCandleCountdownSettingsLoaded] = useState(false);
  const [barCountConfig, setBarCountConfig] = useState(() => ({ ...DEFAULT_BAR_COUNT_CONFIG }));
  const [barCountSettingsLoaded, setBarCountSettingsLoaded] = useState(false);
  const [defaultTrendLineStyle, setDefaultTrendLineStyle] = useState<TrendLineStyle>(DEFAULT_TREND_LINE_STYLE);
  const [trendLineTemplates, setTrendLineTemplates] = useState<TrendLineTemplate[]>([]);
  const [defaultFibonacciStyle, setDefaultFibonacciStyle] = useState<FibonacciRetracementStyle>(() => cloneFibonacciStyle(DEFAULT_FIBONACCI_RETRACEMENT_STYLE));
  const [fibonacciTemplates, setFibonacciTemplates] = useState<FibonacciRetracementTemplate[]>([]);
  const [drawingPreferencesLoaded, setDrawingPreferencesLoaded] = useState(false);
  const [displayUtcOffsetMinutes, setDisplayUtcOffsetMinutes] = useState(() => (
    utcOffsetMinutesForTimezone(dataset.startTime, dataset.timezone)
  ));
  const [displayTimezoneLoaded, setDisplayTimezoneLoaded] = useState(false);

  useEffect(() => {
    const stored = loadEmaSettings();
    if (stored) {
      setEmaEnabled(stored.enabled);
      setEmaIndicators(stored.indicators);
    }
    setEmaSettingsLoaded(true);
  }, []);

  useEffect(() => {
    const stored = loadAbrSettings();
    if (stored) {
      setAbrEnabled(stored.enabled);
      setAbrLength(stored.length);
    }
    setAbrSettingsLoaded(true);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VOLUME_VISIBILITY_STORAGE_KEY);
      setVolumeVisible(stored === null ? true : stored === "true");
    } catch {
      setVolumeVisible(true);
    }
    setVolumeVisibilityLoaded(true);
  }, []);

  useEffect(() => {
    try {
      setCandleCountdownEnabled(window.localStorage.getItem(CANDLE_COUNTDOWN_VISIBILITY_STORAGE_KEY) === "true");
    } catch {
      setCandleCountdownEnabled(false);
    }
    setCandleCountdownSettingsLoaded(true);
  }, []);

  useEffect(() => {
    try {
      setBarCountConfig(parseBarCountPreferences(window.localStorage.getItem(BAR_COUNT_SETTINGS_STORAGE_KEY)));
    } catch {
      setBarCountConfig({ ...DEFAULT_BAR_COUNT_CONFIG });
    }
    setBarCountSettingsLoaded(true);
  }, []);

  useEffect(() => {
    try {
      setCandlestickStyle(parseCandlestickStyle(window.localStorage.getItem(CANDLESTICK_STYLE_STORAGE_KEY)));
    } catch {
      setCandlestickStyle(DEFAULT_CANDLESTICK_STYLE);
    }
    setCandlestickStyleLoaded(true);
  }, []);

  useEffect(() => {
    if (!candlestickStyleLoaded) return;
    try {
      window.localStorage.setItem(CANDLESTICK_STYLE_STORAGE_KEY, JSON.stringify(candlestickStyle));
    } catch {
      // Browser storage can be unavailable; the style still applies to this page session.
    }
  }, [candlestickStyle, candlestickStyleLoaded]);

  useEffect(() => {
    const fallback = utcOffsetMinutesForTimezone(dataset.startTime, dataset.timezone);
    try {
      const storedValue = window.localStorage.getItem(`${DISPLAY_TIMEZONE_STORAGE_KEY}:${dataset.id}`);
      const stored = storedValue === null ? Number.NaN : Number(storedValue);
      setDisplayUtcOffsetMinutes(isSupportedUtcOffsetMinutes(stored) ? stored : fallback);
    } catch {
      setDisplayUtcOffsetMinutes(fallback);
    }
    setDisplayTimezoneLoaded(true);
  }, [dataset.id, dataset.startTime, dataset.timezone]);

  useEffect(() => {
    if (!displayTimezoneLoaded) return;
    try {
      window.localStorage.setItem(`${DISPLAY_TIMEZONE_STORAGE_KEY}:${dataset.id}`, String(displayUtcOffsetMinutes));
    } catch {
      // Browser storage can be unavailable; the selected timezone still applies to this page session.
    }
  }, [dataset.id, displayTimezoneLoaded, displayUtcOffsetMinutes]);

  useEffect(() => {
    if (!emaSettingsLoaded) return;
    try {
      window.localStorage.setItem(EMA_SETTINGS_STORAGE_KEY, JSON.stringify({ enabled: emaEnabled, indicators: emaIndicators }));
    } catch {
      // Browser storage can be unavailable; EMA controls still work for the current page session.
    }
  }, [emaEnabled, emaIndicators, emaSettingsLoaded]);

  useEffect(() => {
    if (!abrSettingsLoaded) return;
    try {
      window.localStorage.setItem(ABR_SETTINGS_STORAGE_KEY, JSON.stringify({ enabled: abrEnabled, length: abrLength }));
    } catch {
      // Browser storage can be unavailable; ABR settings still apply to this page session.
    }
  }, [abrEnabled, abrLength, abrSettingsLoaded]);

  useEffect(() => {
    if (!volumeVisibilityLoaded) return;
    try {
      window.localStorage.setItem(VOLUME_VISIBILITY_STORAGE_KEY, String(volumeVisible));
    } catch {
      // Browser storage can be unavailable; the visibility still applies to this page session.
    }
  }, [volumeVisibilityLoaded, volumeVisible]);

  useEffect(() => {
    if (!candleCountdownSettingsLoaded) return;
    try {
      window.localStorage.setItem(CANDLE_COUNTDOWN_VISIBILITY_STORAGE_KEY, String(candleCountdownEnabled));
    } catch {
      // Browser storage can be unavailable; the countdown setting still applies to this page session.
    }
  }, [candleCountdownEnabled, candleCountdownSettingsLoaded]);

  useEffect(() => {
    if (!barCountSettingsLoaded) return;
    try {
      window.localStorage.setItem(BAR_COUNT_SETTINGS_STORAGE_KEY, JSON.stringify(barCountConfig));
    } catch {
      // Browser storage can be unavailable; Bar Count settings still apply to this page session.
    }
  }, [barCountConfig, barCountSettingsLoaded]);

  useEffect(() => {
    let preferences = parseTrendLinePreferences(null);
    let fibonacciPreferences = parseFibonacciRetracementPreferences(null);
    try {
      preferences = parseTrendLinePreferences(window.localStorage.getItem(TREND_LINE_PREFERENCES_STORAGE_KEY));
      fibonacciPreferences = parseFibonacciRetracementPreferences(window.localStorage.getItem(FIBONACCI_PREFERENCES_STORAGE_KEY));
    } catch {
      // Browser storage can be unavailable; defaults still work for this page session.
    }
    setDefaultTrendLineStyle(preferences.defaultStyle);
    setTrendLineTemplates(preferences.templates);
    setDefaultFibonacciStyle(cloneFibonacciStyle(fibonacciPreferences.defaultStyle));
    setFibonacciTemplates(fibonacciPreferences.templates);
    setDrawingPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!drawingPreferencesLoaded) return;
    try {
      window.localStorage.setItem(TREND_LINE_PREFERENCES_STORAGE_KEY, JSON.stringify({
        defaultStyle: defaultTrendLineStyle,
        templates: trendLineTemplates,
      }));
      window.localStorage.setItem(FIBONACCI_PREFERENCES_STORAGE_KEY, JSON.stringify({
        defaultStyle: defaultFibonacciStyle,
        templates: fibonacciTemplates,
      }));
    } catch {
      // Drawing preferences still apply until this page closes.
    }
  }, [defaultFibonacciStyle, defaultTrendLineStyle, drawingPreferencesLoaded, fibonacciTemplates, trendLineTemplates]);

  return {
    candlestickStyle,
    setCandlestickStyle,
    emaEnabled,
    setEmaEnabled,
    emaIndicators,
    setEmaIndicators,
    emaSettingsLoaded,
    abrEnabled,
    setAbrEnabled,
    abrLength,
    setAbrLength,
    abrSettingsLoaded,
    volumeVisible,
    setVolumeVisible,
    candleCountdownEnabled,
    setCandleCountdownEnabled,
    barCountConfig,
    setBarCountConfig,
    defaultTrendLineStyle,
    setDefaultTrendLineStyle,
    trendLineTemplates,
    setTrendLineTemplates,
    defaultFibonacciStyle,
    setDefaultFibonacciStyle,
    fibonacciTemplates,
    setFibonacciTemplates,
    displayUtcOffsetMinutes,
    setDisplayUtcOffsetMinutes,
  };
}
