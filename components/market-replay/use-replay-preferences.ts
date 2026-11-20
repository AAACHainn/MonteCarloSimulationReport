"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CANDLESTICK_STYLE,
  parseCandlestickStyle,
  type CandlestickStyle,
} from "@/lib/market-replay/candlestick-style";
import {
  DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
  DEFAULT_TREND_LINE_STYLE,
  DEFAULT_RECTANGLE_STYLE,
  DEFAULT_TEXT_STYLE, parseTextPreferences, type TextDrawingStyle, type TextTemplate,
  parseRectanglePreferences,
  type RectangleStyle,
  type RectangleTemplate,
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
  DEFAULT_REPLAY_CHART_VISIBILITY,
  parseReplayChartVisibility,
} from "@/lib/market-replay/chart-visibility";
import {
  ABR_LENGTH_MAX,
  ABR_LENGTH_MIN,
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  MAX_EMA_INDICATORS,
  type EmaIndicatorConfig,
} from "@/lib/market-replay/types";

import { CHART_DISPLAY_STORAGE_KEY, chartDisplayConfig, parseChartSelection, type ChartDisplayConfig } from "@/lib/market-replay/chart-display";

const EMA_SETTINGS_STORAGE_KEY = "market-replay-ema-settings-v1";
const ABR_SETTINGS_STORAGE_KEY = "market-replay-abr-settings-v1";
const GRID_VISIBILITY_STORAGE_KEY = "market-replay-grid-visibility-v1";
const VOLUME_VISIBILITY_STORAGE_KEY = "market-replay-volume-visibility-v1";
const CANDLE_COUNTDOWN_VISIBILITY_STORAGE_KEY = "market-replay-candle-countdown-visibility-v1";
const BAR_COUNT_SETTINGS_STORAGE_KEY = "market-replay-bar-count-settings-v1";
const DISPLAY_TIMEZONE_STORAGE_KEY = "market-replay-display-timezone-v1";
const CANDLESTICK_STYLE_STORAGE_KEY = "market-replay-candlestick-style-v1";
const TREND_LINE_PREFERENCES_STORAGE_KEY = "market-replay-trend-line-preferences-v1";
const RECTANGLE_PREFERENCES_STORAGE_KEY = "market-replay-rectangle-preferences-v1";
const FIBONACCI_PREFERENCES_STORAGE_KEY = "market-replay-fibonacci-preferences-v1";
const TEXT_PREFERENCES_STORAGE_KEY = "market-replay-text-preferences-v1";
const CHART_VISIBILITY_STORAGE_KEY = "market-replay-chart-visibility-v1";

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

function loadEmaSettings(key = EMA_SETTINGS_STORAGE_KEY) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
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

function loadAbrSettings(key = ABR_SETTINGS_STORAGE_KEY) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
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

export function useReplayPreferences(dataset: { id: string; startTime: string; timezone: string }, pane = 1) {
  const paneKey = useCallback((key: string) => pane === 1 ? key : key + ':pane:' + pane, [pane]);
  const [candlestickStyle, setCandlestickStyle] = useState<CandlestickStyle>(DEFAULT_CANDLESTICK_STYLE);
  const [candlestickStyleLoaded, setCandlestickStyleLoaded] = useState(false);
  const [chartSelection, setChartSelection] = useState(() => parseChartSelection(null));
  const [chartSelectionLoaded, setChartSelectionLoaded] = useState(false);
  const chartStyle = useMemo(() => chartDisplayConfig(candlestickStyle, chartSelection), [candlestickStyle, chartSelection]);
  const setChartStyle = useCallback((next: ChartDisplayConfig) => {
    setCandlestickStyle({ ...next.candlestickStyle });
    setChartSelection({ chartType: next.chartType, line: { ...next.line } });
  }, []);
  useEffect(() => {
    try { setChartSelection(parseChartSelection(window.localStorage.getItem(paneKey(CHART_DISPLAY_STORAGE_KEY)))); }
    catch { setChartSelection(parseChartSelection(null)); }
    setChartSelectionLoaded(true);
  }, [paneKey]);
  useEffect(() => {
    if (!chartSelectionLoaded) return;
    try { window.localStorage.setItem(paneKey(CHART_DISPLAY_STORAGE_KEY), JSON.stringify(chartSelection)); }
    catch { /* Current-page selection remains usable without storage. */ }
  }, [chartSelection, chartSelectionLoaded, paneKey]);
  const [emaEnabled, setEmaEnabled] = useState(false);
  const [emaIndicators, setEmaIndicators] = useState<EmaIndicatorConfig[]>(DEFAULT_EMA_INDICATORS);
  const [emaSettingsLoaded, setEmaSettingsLoaded] = useState(false);
  const [abrEnabled, setAbrEnabled] = useState(false);
  const [abrLength, setAbrLength] = useState(8);
  const [abrSettingsLoaded, setAbrSettingsLoaded] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [gridVisibilityLoaded, setGridVisibilityLoaded] = useState(false);
  const [volumeVisible, setVolumeVisible] = useState(true);
  const [volumeVisibilityLoaded, setVolumeVisibilityLoaded] = useState(false);
  const [candleCountdownEnabled, setCandleCountdownEnabled] = useState(false);
  const [candleCountdownSettingsLoaded, setCandleCountdownSettingsLoaded] = useState(false);
  const [barCountConfig, setBarCountConfig] = useState(() => ({ ...DEFAULT_BAR_COUNT_CONFIG }));
  const [barCountSettingsLoaded, setBarCountSettingsLoaded] = useState(false);
  const [chartVisibility, setChartVisibility] = useState(() => ({ ...DEFAULT_REPLAY_CHART_VISIBILITY }));
  const [chartVisibilityLoaded, setChartVisibilityLoaded] = useState(false);
  const [defaultTrendLineStyle, setDefaultTrendLineStyle] = useState<TrendLineStyle>(DEFAULT_TREND_LINE_STYLE);
  const [trendLineTemplates, setTrendLineTemplates] = useState<TrendLineTemplate[]>([]);
  const [defaultFibonacciStyle, setDefaultFibonacciStyle] = useState<FibonacciRetracementStyle>(() => cloneFibonacciStyle(DEFAULT_FIBONACCI_RETRACEMENT_STYLE));
  const [fibonacciTemplates, setFibonacciTemplates] = useState<FibonacciRetracementTemplate[]>([]);
  const [defaultRectangleStyle, setDefaultRectangleStyle] = useState<RectangleStyle>(() => ({ ...DEFAULT_RECTANGLE_STYLE }));
  const [rectangleTemplates, setRectangleTemplates] = useState<RectangleTemplate[]>([]);
  const [defaultTextStyle, setDefaultTextStyle] = useState<TextDrawingStyle>(() => ({ ...DEFAULT_TEXT_STYLE }));
  const [textTemplates, setTextTemplates] = useState<TextTemplate[]>([]);
  const [drawingPreferencesLoaded, setDrawingPreferencesLoaded] = useState(false);
  const [displayUtcOffsetMinutes, setDisplayUtcOffsetMinutes] = useState(() => (
    utcOffsetMinutesForTimezone(dataset.startTime, dataset.timezone)
  ));
  const [displayTimezoneLoaded, setDisplayTimezoneLoaded] = useState(false);

  useEffect(() => {
    const stored = loadEmaSettings(paneKey(EMA_SETTINGS_STORAGE_KEY));
    if (stored) {
      setEmaEnabled(stored.enabled);
      setEmaIndicators(stored.indicators);
    }
    setEmaSettingsLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    const stored = loadAbrSettings(paneKey(ABR_SETTINGS_STORAGE_KEY));
    if (stored) {
      setAbrEnabled(stored.enabled);
      setAbrLength(stored.length);
    }
    setAbrSettingsLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    try {
      setGridVisible(window.localStorage.getItem(paneKey(GRID_VISIBILITY_STORAGE_KEY)) !== "false");
    } catch {
      setGridVisible(true);
    }
    setGridVisibilityLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(paneKey(VOLUME_VISIBILITY_STORAGE_KEY));
      setVolumeVisible(stored === null ? true : stored === "true");
    } catch {
      setVolumeVisible(true);
    }
    setVolumeVisibilityLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    try {
      setCandleCountdownEnabled(window.localStorage.getItem(paneKey(CANDLE_COUNTDOWN_VISIBILITY_STORAGE_KEY)) === "true");
    } catch {
      setCandleCountdownEnabled(false);
    }
    setCandleCountdownSettingsLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    try {
      setBarCountConfig(parseBarCountPreferences(window.localStorage.getItem(paneKey(BAR_COUNT_SETTINGS_STORAGE_KEY))));
    } catch {
      setBarCountConfig({ ...DEFAULT_BAR_COUNT_CONFIG });
    }
    setBarCountSettingsLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    try {
      setChartVisibility(parseReplayChartVisibility(window.localStorage.getItem(paneKey(CHART_VISIBILITY_STORAGE_KEY))));
    } catch {
      setChartVisibility({ ...DEFAULT_REPLAY_CHART_VISIBILITY });
    }
    setChartVisibilityLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    try {
      setCandlestickStyle(parseCandlestickStyle(window.localStorage.getItem(paneKey(CANDLESTICK_STYLE_STORAGE_KEY))));
    } catch {
      setCandlestickStyle(DEFAULT_CANDLESTICK_STYLE);
    }
    setCandlestickStyleLoaded(true);
  }, [paneKey]);

  useEffect(() => {
    if (!candlestickStyleLoaded) return;
    try {
      window.localStorage.setItem(paneKey(CANDLESTICK_STYLE_STORAGE_KEY), JSON.stringify(candlestickStyle));
    } catch {
      // Browser storage can be unavailable; the style still applies to this page session.
    }
  }, [candlestickStyle, candlestickStyleLoaded, paneKey]);

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
    if (pane !== 1 || !displayTimezoneLoaded) return;
    try {
      window.localStorage.setItem(`${DISPLAY_TIMEZONE_STORAGE_KEY}:${dataset.id}`, String(displayUtcOffsetMinutes));
    } catch {
      // Browser storage can be unavailable; the selected timezone still applies to this page session.
    }
  }, [dataset.id, displayTimezoneLoaded, displayUtcOffsetMinutes, pane]);

  useEffect(() => {
    if (!emaSettingsLoaded) return;
    try {
      window.localStorage.setItem(paneKey(EMA_SETTINGS_STORAGE_KEY), JSON.stringify({ enabled: emaEnabled, indicators: emaIndicators }));
    } catch {
      // Browser storage can be unavailable; EMA controls still work for the current page session.
    }
  }, [emaEnabled, emaIndicators, emaSettingsLoaded, paneKey]);

  useEffect(() => {
    if (!abrSettingsLoaded) return;
    try {
      window.localStorage.setItem(paneKey(ABR_SETTINGS_STORAGE_KEY), JSON.stringify({ enabled: abrEnabled, length: abrLength }));
    } catch {
      // Browser storage can be unavailable; ABR settings still apply to this page session.
    }
  }, [abrEnabled, abrLength, abrSettingsLoaded, paneKey]);

  useEffect(() => {
    if (!gridVisibilityLoaded) return;
    try {
      window.localStorage.setItem(paneKey(GRID_VISIBILITY_STORAGE_KEY), String(gridVisible));
    } catch {
      // Browser storage can be unavailable; the grid setting still applies to this page session.
    }
  }, [gridVisibilityLoaded, gridVisible, paneKey]);

  useEffect(() => {
    if (!volumeVisibilityLoaded) return;
    try {
      window.localStorage.setItem(paneKey(VOLUME_VISIBILITY_STORAGE_KEY), String(volumeVisible));
    } catch {
      // Browser storage can be unavailable; the visibility still applies to this page session.
    }
  }, [volumeVisibilityLoaded, volumeVisible, paneKey]);

  useEffect(() => {
    if (!candleCountdownSettingsLoaded) return;
    try {
      window.localStorage.setItem(paneKey(CANDLE_COUNTDOWN_VISIBILITY_STORAGE_KEY), String(candleCountdownEnabled));
    } catch {
      // Browser storage can be unavailable; the countdown setting still applies to this page session.
    }
  }, [candleCountdownEnabled, candleCountdownSettingsLoaded, paneKey]);

  useEffect(() => {
    if (!barCountSettingsLoaded) return;
    try {
      window.localStorage.setItem(paneKey(BAR_COUNT_SETTINGS_STORAGE_KEY), JSON.stringify(barCountConfig));
    } catch {
      // Browser storage can be unavailable; Bar Count settings still apply to this page session.
    }
  }, [barCountConfig, barCountSettingsLoaded, paneKey]);

  useEffect(() => {
    if (!chartVisibilityLoaded) return;
    try {
      window.localStorage.setItem(paneKey(CHART_VISIBILITY_STORAGE_KEY), JSON.stringify(chartVisibility));
    } catch {
      // Browser storage can be unavailable; visibility still applies to this page session.
    }
  }, [chartVisibility, chartVisibilityLoaded, paneKey]);

  useEffect(() => {
    if (pane !== 1) return;
    let preferences = parseTrendLinePreferences(null);
    let fibonacciPreferences = parseFibonacciRetracementPreferences(null);
    let rectanglePreferences = parseRectanglePreferences(null);
    let textPreferences = parseTextPreferences(null);
    try {
      textPreferences = parseTextPreferences(window.localStorage.getItem(TEXT_PREFERENCES_STORAGE_KEY));
      rectanglePreferences = parseRectanglePreferences(window.localStorage.getItem(RECTANGLE_PREFERENCES_STORAGE_KEY));
      preferences = parseTrendLinePreferences(window.localStorage.getItem(TREND_LINE_PREFERENCES_STORAGE_KEY));
      fibonacciPreferences = parseFibonacciRetracementPreferences(window.localStorage.getItem(FIBONACCI_PREFERENCES_STORAGE_KEY));
    } catch {
      // Browser storage can be unavailable; defaults still work for this page session.
    }
    setDefaultTrendLineStyle(preferences.defaultStyle);
    setTrendLineTemplates(preferences.templates);
    setDefaultFibonacciStyle(cloneFibonacciStyle(fibonacciPreferences.defaultStyle));
    setFibonacciTemplates(fibonacciPreferences.templates);
    setDefaultRectangleStyle(rectanglePreferences.defaultStyle);
    setRectangleTemplates(rectanglePreferences.templates);
    setDefaultTextStyle(textPreferences.defaultStyle);
    setTextTemplates(textPreferences.templates);
    setDrawingPreferencesLoaded(true);
  }, [pane]);

  useEffect(() => {
    if (pane !== 1 || !drawingPreferencesLoaded) return;
    try {
      window.localStorage.setItem(RECTANGLE_PREFERENCES_STORAGE_KEY, JSON.stringify({ defaultStyle: defaultRectangleStyle, templates: rectangleTemplates }));
      window.localStorage.setItem(TEXT_PREFERENCES_STORAGE_KEY, JSON.stringify({ defaultStyle: defaultTextStyle, templates: textTemplates }));
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
  }, [defaultTextStyle, textTemplates, defaultRectangleStyle, rectangleTemplates, defaultFibonacciStyle, defaultTrendLineStyle, drawingPreferencesLoaded, fibonacciTemplates, trendLineTemplates, pane]);

  return {
    chartStyle, setChartStyle,
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
    gridVisible,
    setGridVisible,
    volumeVisible,
    setVolumeVisible,
    candleCountdownEnabled,
    setCandleCountdownEnabled,
    barCountConfig,
    setBarCountConfig,
    chartVisibility,
    setChartVisibility,
    defaultRectangleStyle,
    defaultTextStyle, setDefaultTextStyle, textTemplates, setTextTemplates,
    setDefaultRectangleStyle,
    rectangleTemplates,
    setRectangleTemplates,
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


// Read-only capture for export; does not mount hooks or write chart preferences.
export function capturePdfChartPreferences(dataset: { id: string; startTime: string; timezone: string }): import("@/lib/paper-trading/pdf-types").PdfChartPreferences {
  const get = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
  const ema = loadEmaSettings();
  const visibility = parseReplayChartVisibility(get(CHART_VISIBILITY_STORAGE_KEY));
  const offset = Number(get(`${DISPLAY_TIMEZONE_STORAGE_KEY}:${dataset.id}`) ?? Number.NaN);
  const barCountConfig = parseBarCountPreferences(get(BAR_COUNT_SETTINGS_STORAGE_KEY));
  return {
    barCountConfig: { ...barCountConfig, enabled: barCountConfig.enabled && visibility.indicators },
    candlestickStyle: parseCandlestickStyle(get(CANDLESTICK_STYLE_STORAGE_KEY)),
    emaEnabled: Boolean(ema?.enabled) && visibility.indicators,
    emaIndicators: ema?.indicators ?? DEFAULT_EMA_INDICATORS.map((i) => ({ ...i })),
    gridVisible: get(GRID_VISIBILITY_STORAGE_KEY) !== "false",
    volumeVisible: get(VOLUME_VISIBILITY_STORAGE_KEY) !== "false",
    displayUtcOffsetMinutes: isSupportedUtcOffsetMinutes(offset) ? offset : utcOffsetMinutesForTimezone(dataset.startTime, dataset.timezone),
  };
}
