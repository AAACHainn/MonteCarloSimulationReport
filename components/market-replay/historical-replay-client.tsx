"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Loader2, Palette, Ruler, Settings2, Trash2, TrendingUp, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { ReplayChart } from "@/components/market-replay/replay-chart";
import { IndicatorSettingsDialog } from "@/components/market-replay/indicator-settings-dialog";
import { useReplayPreferences } from "@/components/market-replay/use-replay-preferences";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/i18n";
import { isValidBarCountInterval, isValidBarCountRecentTradingDays } from "@/lib/market-replay/bar-count";
import type { CandlestickStyle } from "@/lib/market-replay/candlestick-style";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import {
  DRAWING_TYPE_FIB_RETRACEMENT,
  DRAWING_TYPE_TREND_LINE,
  createMarketDrawingSchema,
  type DrawingTool,
  type MarketDrawing,
  type TrendLineGeometry,
} from "@/lib/market-replay/chart-drawings";
import { datasetSession } from "@/lib/market-replay/dataset";
import type {
  AggregatedMarketBarData,
  DisplaySession,
  MarketDatasetSummary,
} from "@/lib/market-replay/types";
import {
  ABR_LENGTH_MAX,
  ABR_LENGTH_MIN,
  BAR_COUNT_INTERVAL_MAX,
  BAR_COUNT_INTERVAL_MIN,
  BAR_COUNT_RECENT_TRADING_DAYS_MAX,
  BAR_COUNT_RECENT_TRADING_DAYS_MIN,
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  MAX_EMA_INDICATORS,
} from "@/lib/market-replay/types";
import type { ReplayTradeAnnotationData } from "@/lib/paper-trading/types";

type HistoricalReplaySession = {
  id: string;
  startSequence: number;
  endSequence: number;
  displayIntervalSeconds: number;
  displaySession: DisplaySession;
};

type WindowPayload = {
  visibleBars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
};

type AnnotationPayload = {
  items: ReplayTradeAnnotationData[];
  truncated: boolean;
};

const VISIBLE_BAR_COUNT = 1_200;
const noOp = () => undefined;
const noOpAsync = async () => false;

function historicalDrawingStorageKey(datasetId: string, sessionId: string) {
  return `market-replay-history-drawings-v1:${datasetId}:${sessionId}`;
}

function parseStoredDrawings(value: string | null, datasetId: string): MarketDrawing[] {
  if (!value) return [];
  try {
    const candidates = JSON.parse(value) as unknown;
    if (!Array.isArray(candidates)) return [];
    return candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const record = candidate as Partial<MarketDrawing>;
      const parsed = createMarketDrawingSchema.safeParse({
        type: record.type,
        geometry: record.geometry,
        style: record.style,
      });
      if (!parsed.success || typeof record.id !== "string") return [];
      const timestamp = new Date().toISOString();
      return [{
        id: record.id,
        datasetId,
        ...parsed.data,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : timestamp,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : timestamp,
      } as MarketDrawing];
    });
  } catch {
    return [];
  }
}

export function HistoricalReplayClient({
  dataset,
  session,
  focusSequence,
}: {
  dataset: MarketDatasetSummary;
  session: HistoricalReplaySession;
  focusSequence: number;
}) {
  const [bars, setBars] = useState<AggregatedMarketBarData[]>([]);
  const [warmupBars, setWarmupBars] = useState<AggregatedMarketBarData[]>([]);
  const [annotations, setAnnotations] = useState<ReplayTradeAnnotationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [measurementArmed, setMeasurementArmed] = useState(false);
  const [drawingToolOpen, setDrawingToolOpen] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null);
  const [drawingObjectsOpen, setDrawingObjectsOpen] = useState(false);
  const [drawings, setDrawings] = useState<MarketDrawing[]>([]);
  const [drawingsLoaded, setDrawingsLoaded] = useState(false);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"candlesticks" | "indicators" | null>(null);
  const [candlestickStyleDraft, setCandlestickStyleDraft] = useState<CandlestickStyle | null>(null);
  const [indicatorError, setIndicatorError] = useState<string | null>(null);
  const annotationAbortRef = useRef<AbortController | null>(null);
  const initialLoadCompletedRef = useRef(false);
  const {
    candlestickStyle,
    setCandlestickStyle,
    emaEnabled,
    setEmaEnabled,
    emaIndicators,
    setEmaIndicators,
    abrEnabled,
    setAbrEnabled,
    abrLength,
    setAbrLength,
    volumeVisible,
    setVolumeVisible,
    barCountConfig,
    setBarCountConfig,
    defaultTrendLineStyle,
    defaultFibonacciStyle,
    displayUtcOffsetMinutes,
  } = useReplayPreferences(dataset);
  const indicatorWarmupCount = Math.max(
    abrEnabled ? abrLength : 0,
    emaEnabled ? Math.max(0, ...emaIndicators.filter((indicator) => indicator.visible).map((indicator) => indicator.length)) : 0,
  );
  const barCountSession = useMemo(
    () => resolveDisplaySession(dataset, session.displaySession) ?? datasetSession(dataset),
    [dataset, session.displaySession],
  );

  useEffect(() => {
    try {
      setDrawings(parseStoredDrawings(
        window.localStorage.getItem(historicalDrawingStorageKey(dataset.id, session.id)),
        dataset.id,
      ));
    } finally {
      setDrawingsLoaded(true);
    }
  }, [dataset.id, session.id]);

  useEffect(() => {
    if (!drawingsLoaded) return;
    try {
      window.localStorage.setItem(
        historicalDrawingStorageKey(dataset.id, session.id),
        JSON.stringify(drawings),
      );
    } catch {
      // Browser storage is optional; drawings remain available for this page lifetime.
    }
  }, [dataset.id, drawings, drawingsLoaded, session.id]);

  const armDrawing = useCallback((tool: DrawingTool) => {
    setMeasurementArmed(false);
    setDrawingTool(tool);
    setDrawingToolOpen(false);
    setSelectedDrawingId(null);
  }, []);

  const createDrawing = useCallback((type: DrawingTool, geometry: TrendLineGeometry) => {
    const now = new Date().toISOString();
    const drawing = {
      id: `history-${session.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      datasetId: dataset.id,
      type,
      geometry,
      style: type === DRAWING_TYPE_TREND_LINE
        ? { ...defaultTrendLineStyle }
        : { ...defaultFibonacciStyle, levels: defaultFibonacciStyle.levels.map((level) => ({ ...level })) },
      createdAt: now,
      updatedAt: now,
    } as MarketDrawing;
    setDrawings((current) => [...current, drawing]);
    setSelectedDrawingId(drawing.id);
  }, [dataset.id, defaultFibonacciStyle, defaultTrendLineStyle, session.id]);

  const updateDrawing = useCallback((id: string, geometry: TrendLineGeometry) => {
    setDrawings((current) => current.map((drawing) => drawing.id === id
      ? { ...drawing, geometry, updatedAt: new Date().toISOString() }
      : drawing));
  }, []);

  const deleteDrawing = useCallback((id: string) => {
    setDrawings((current) => current.filter((drawing) => drawing.id !== id));
    setSelectedDrawingId((current) => current === id ? null : current);
  }, []);

  const loadAnnotations = useCallback(async (fromSequence: number, toSequence: number) => {
    annotationAbortRef.current?.abort();
    const controller = new AbortController();
    annotationAbortRef.current = controller;
    const params = new URLSearchParams({
      fromSequence: String(fromSequence),
      toSequence: String(toSequence),
      journalSessionId: session.id,
    });
    try {
      const response = await fetch(
        `/api/market-datasets/${dataset.id}/paper-journal/annotations?${params}`,
        { signal: controller.signal },
      );
      const data = await response.json() as AnnotationPayload & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setAnnotations(data.items);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error && cause.message
          ? cause.message
          : copy.paperTrading.historicalReplayLoadFailed);
      }
      return false;
    }
  }, [dataset.id, session.id]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      displayIntervalSeconds: String(session.displayIntervalSeconds),
      displaySession: session.displaySession,
      endSequence: String(session.endSequence),
      focusSequence: String(focusSequence),
      visibleCount: String(VISIBLE_BAR_COUNT),
      warmupCount: String(Math.min(EMA_LENGTH_MAX, indicatorWarmupCount)),
    });
    void (async () => {
      if (!initialLoadCompletedRef.current) setLoading(true);
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, {
          signal: controller.signal,
        });
        const data = await response.json() as WindowPayload & { error?: string };
        if (!response.ok) throw new Error(data.error);
        setBars(data.visibleBars);
        setWarmupBars(data.warmupBars);
        const annotationsLoaded = await loadAnnotations(session.startSequence, session.endSequence);
        if (!annotationsLoaded) return;
        setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error && cause.message
            ? cause.message
            : copy.paperTrading.historicalReplayLoadFailed);
        }
      } finally {
        if (!controller.signal.aborted) {
          initialLoadCompletedRef.current = true;
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [dataset.id, focusSequence, indicatorWarmupCount, loadAnnotations, session.displayIntervalSeconds, session.displaySession, session.endSequence, session.startSequence]);

  useEffect(() => () => {
    annotationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || (key !== "t" && key !== "f")) return;
      const target = event.target as HTMLElement | null;
      if (settingsDialog || target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      armDrawing(key === "t" ? DRAWING_TYPE_TREND_LINE : DRAWING_TYPE_FIB_RETRACEMENT);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armDrawing, settingsDialog]);

  function updateAbrLength(value: number) {
    if (!Number.isInteger(value) || value < ABR_LENGTH_MIN || value > ABR_LENGTH_MAX) {
      setIndicatorError(copy.marketReplay.abrLengthRange(ABR_LENGTH_MIN, ABR_LENGTH_MAX));
      return false;
    }
    setAbrLength(value);
    setIndicatorError(null);
    return true;
  }

  function updateEmaLength(id: string, value: number) {
    if (!Number.isInteger(value) || value < EMA_LENGTH_MIN || value > EMA_LENGTH_MAX) {
      setIndicatorError(copy.marketReplay.emaLengthRange(EMA_LENGTH_MIN, EMA_LENGTH_MAX));
      return false;
    }
    setEmaIndicators((current) => current.map((indicator) => indicator.id === id
      ? { ...indicator, length: value }
      : indicator));
    setIndicatorError(null);
    return true;
  }

  function updateBarCountRecentTradingDays(value: number) {
    if (!isValidBarCountRecentTradingDays(value)) {
      setIndicatorError(copy.marketReplay.barCountRecentTradingDaysRange(
        BAR_COUNT_RECENT_TRADING_DAYS_MIN,
        BAR_COUNT_RECENT_TRADING_DAYS_MAX,
      ));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, recentTradingDays: value }));
    setIndicatorError(null);
    return true;
  }

  function updateBarCountInterval(value: number) {
    if (!isValidBarCountInterval(value)) {
      setIndicatorError(copy.marketReplay.barCountIntervalRange(BAR_COUNT_INTERVAL_MIN, BAR_COUNT_INTERVAL_MAX));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, interval: value }));
    setIndicatorError(null);
    return true;
  }

  function addEma() {
    if (emaIndicators.length >= MAX_EMA_INDICATORS) return;
    const sequence = Date.now().toString(36);
    setEmaIndicators((current) => [...current, {
      id: `history-ema-${sequence}`,
      length: 20,
      color: "#0F766E",
      lineWidth: 2,
      lineStyle: "SOLID",
      visible: true,
    }]);
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" aria-busy="true">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {copy.marketReplay.loading}
    </div>;
  }

  if (error) {
    return <div className="p-4">
      <Alert className="border-red-200 bg-red-50" role="alert">
        <AlertTitle>{copy.common.error}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    </div>;
  }

  return <>
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-3">
        <Popover.Root open={drawingToolOpen} onOpenChange={setDrawingToolOpen}>
          <Popover.Trigger asChild>
            <Button type="button" variant={drawingTool ? "secondary" : "ghost"} size="sm" className="h-8" aria-pressed={Boolean(drawingTool)} aria-label={copy.marketReplay.drawingToolsHint}>
              <TrendingUp className="h-4 w-4" />{copy.marketReplay.drawingTools}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-[80] w-60 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
              <button type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => armDrawing(DRAWING_TYPE_TREND_LINE)}>
                <TrendingUp className="h-4 w-4 text-slate-600" /><span className="font-medium">{copy.marketReplay.trendLine}</span><kbd className="ml-auto font-mono text-[11px] text-slate-400">{copy.marketReplay.trendLineShortcut}</kbd>
              </button>
              <button type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => armDrawing(DRAWING_TYPE_FIB_RETRACEMENT)}>
                <span className="flex h-4 w-4 items-center justify-center font-mono text-[10px] font-bold text-slate-600">Fib</span><span className="font-medium">{copy.marketReplay.fibonacciRetracement}</span><kbd className="ml-auto font-mono text-[11px] text-slate-400">{copy.marketReplay.fibonacciRetracementShortcut}</kbd>
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button type="button" variant={drawingObjectsOpen ? "secondary" : "ghost"} size="sm" className="h-8" aria-pressed={drawingObjectsOpen} title={copy.marketReplay.drawingObjectsHint} onClick={() => setDrawingObjectsOpen((current) => !current)}>
          <ListTree className="h-4 w-4" />{copy.marketReplay.drawingObjects}
        </Button>
        <Button type="button" variant={measurementArmed ? "secondary" : "ghost"} size="sm" className="h-8" aria-pressed={measurementArmed} aria-label={copy.marketReplay.measureHint} onClick={() => { setDrawingTool(null); setMeasurementArmed((current) => !current); }}>
          <Ruler className="h-4 w-4" />{copy.marketReplay.measure}
        </Button>
        <Button type="button" variant={settingsDialog === "candlesticks" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => { setCandlestickStyleDraft({ ...candlestickStyle }); setSettingsDialog("candlesticks"); }}>
          <Palette className="h-4 w-4" />{copy.marketReplay.candlestickStyle}
        </Button>
        <Button type="button" variant={settingsDialog === "indicators" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setSettingsDialog("indicators")}>
          <Settings2 className="h-4 w-4" />{copy.marketReplay.indicators}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReplayChart
          datasetId={dataset.id}
          priceTickSize={dataset.priceTickSize}
          bars={bars}
          warmupBars={warmupBars}
          displayUtcOffsetMinutes={displayUtcOffsetMinutes}
          displayIntervalSeconds={session.displayIntervalSeconds}
          measurementArmed={measurementArmed}
          candlestickStyle={candlestickStyleDraft ?? candlestickStyle}
          onMeasurementArmedChange={setMeasurementArmed}
          drawingTool={drawingTool}
          onDrawingToolChange={setDrawingTool}
          trendLineDraftStyle={defaultTrendLineStyle}
          fibonacciDraftStyle={defaultFibonacciStyle}
          drawings={drawings}
          selectedDrawingId={selectedDrawingId}
          onSelectedDrawingIdChange={setSelectedDrawingId}
          onCreateDrawing={createDrawing}
          onUpdateDrawing={updateDrawing}
          onDeleteDrawing={deleteDrawing}
          onOpenDrawingStyle={setSelectedDrawingId}
          emaEnabled={emaEnabled}
          emaIndicators={emaIndicators}
          abrEnabled={abrEnabled}
          abrLength={abrLength}
          volumeVisible={volumeVisible}
          displaySession={session.displaySession}
          barCountSession={barCountSession}
          barCountConfig={barCountConfig}
          paperSnapshot={null}
          tradeAnnotations={annotations}
          tradeAnnotationsTruncated={false}
          focusSequence={focusSequence}
          readOnly
          paperBusy={false}
          paperError={null}
          onSubmitOrder={noOpAsync}
          onOrderPriceChange={noOpAsync}
          onCancelOrder={noOpAsync}
          onClosePosition={noOpAsync}
          onDraftActiveChange={noOp}
          onOpenPaperAccount={noOp}
        />
        {drawingObjectsOpen ? <aside className="absolute right-3 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <ListTree className="h-4 w-4 text-slate-500" /><h3 className="text-sm font-semibold text-slate-950">{copy.marketReplay.drawingObjects}</h3>
            <button type="button" className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label={copy.marketReplay.closeDrawingObjects} onClick={() => setDrawingObjectsOpen(false)}><X className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {drawings.length ? drawings.map((drawing, index) => <div key={drawing.id} className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${selectedDrawingId === drawing.id ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}>
              <button type="button" className="min-w-0 flex-1 truncate text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => setSelectedDrawingId(drawing.id)}>
                {drawing.type === DRAWING_TYPE_TREND_LINE ? copy.marketReplay.trendLineObjectName(index + 1) : copy.marketReplay.fibonacciObjectName(index + 1)}
              </button>
              <button type="button" aria-label={drawing.type === DRAWING_TYPE_TREND_LINE ? copy.marketReplay.trendLineDelete : copy.marketReplay.fibonacciDelete} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600" onClick={() => deleteDrawing(drawing.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>) : <p className="p-3 text-xs text-slate-500">{copy.marketReplay.drawingObjectsEmpty}</p>}
          </div>
        </aside> : null}
      </div>
    </div>

    <Dialog open={settingsDialog === "candlesticks"} title={copy.marketReplay.candlestickSettings} description={copy.marketReplay.candlestickSettingsDescription} className="max-w-md" onClose={() => { setCandlestickStyleDraft(null); setSettingsDialog(null); }}>
      {candlestickStyleDraft ? <div className="space-y-5">
        <div className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 px-1 text-center text-xs font-medium text-slate-500"><span /><span>{copy.marketReplay.bullishCandle}</span><span>{copy.marketReplay.bearishCandle}</span></div>
        <div className="space-y-2">{([
          { visible: "bodyVisible", up: "upColor", down: "downColor", label: copy.marketReplay.candleBody },
          { visible: "borderVisible", up: "borderUpColor", down: "borderDownColor", label: copy.marketReplay.candleBorder },
          { visible: "wickVisible", up: "wickUpColor", down: "wickDownColor", label: copy.marketReplay.candleWick },
        ] as const).map((row) => <div key={row.visible} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 rounded-md border px-3 py-2.5">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={candlestickStyleDraft[row.visible]} onChange={(event) => setCandlestickStyleDraft((current) => current ? { ...current, [row.visible]: event.target.checked } : current)} className="h-4 w-4 rounded border-slate-300" />{row.label}</label>
          <Input type="color" value={candlestickStyleDraft[row.up]} aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bullishCandle)} onChange={(event) => setCandlestickStyleDraft((current) => current ? { ...current, [row.up]: event.target.value.toUpperCase() } : current)} className="mx-auto h-9 w-12 cursor-pointer p-1" />
          <Input type="color" value={candlestickStyleDraft[row.down]} aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bearishCandle)} onChange={(event) => setCandlestickStyleDraft((current) => current ? { ...current, [row.down]: event.target.value.toUpperCase() } : current)} className="mx-auto h-9 w-12 cursor-pointer p-1" />
        </div>)}</div>
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => { setCandlestickStyleDraft(null); setSettingsDialog(null); }}>{copy.marketReplay.drawingCancel}</Button><Button type="button" onClick={() => { setCandlestickStyle({ ...candlestickStyleDraft }); setCandlestickStyleDraft(null); setSettingsDialog(null); }}>{copy.marketReplay.drawingConfirm}</Button></div>
      </div> : null}
    </Dialog>

    <IndicatorSettingsDialog
      open={settingsDialog === "indicators"}
      onClose={() => setSettingsDialog(null)}
      volumeVisible={volumeVisible}
      onVolumeVisibleChange={setVolumeVisible}
      barCountConfig={barCountConfig}
      setBarCountConfig={setBarCountConfig}
      onBarCountRecentTradingDaysChange={updateBarCountRecentTradingDays}
      onBarCountIntervalChange={updateBarCountInterval}
      barCountError={indicatorError}
      abrEnabled={abrEnabled}
      onAbrEnabledChange={setAbrEnabled}
      abrLength={abrLength}
      onAbrLengthChange={updateAbrLength}
      abrError={indicatorError}
      emaEnabled={emaEnabled}
      onEmaEnabledChange={setEmaEnabled}
      emaIndicators={emaIndicators}
      setEmaIndicators={setEmaIndicators}
      onEmaLengthChange={updateEmaLength}
      onAddEma={addEma}
      emaError={indicatorError}
    />
  </>;
}
