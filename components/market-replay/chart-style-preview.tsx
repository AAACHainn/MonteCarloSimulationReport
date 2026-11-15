"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useHistoricalPlayback } from "./use-historical-playback";
import { HistoricalPlaybackBar } from "./historical-playback-bar";
import { useWebFullscreen } from "./use-web-fullscreen";
import { ChartCandlestick } from "lucide-react";
import { useAppearance } from "@/components/appearance-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatQuantity } from "@/lib/format";
import { createUuid } from "@/lib/uuid";
import { aggregateMarketBars } from "@/lib/market-replay/aggregation";
import { cloneChartDisplay, type ChartDisplayConfig } from "@/lib/market-replay/chart-display";
import { DEFAULT_RECTANGLE_STYLE, DEFAULT_TREND_LINE_STYLE, DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_TEXT_STYLE, DEFAULT_ARROW_STYLES, DEFAULT_ABCD_STYLE, type DrawingTool, type MarketDrawing, type TrendLineGeometry, type TwoPointDrawingTool } from "@/lib/market-replay/chart-drawings";
import { PREVIEW_DATASET, PREVIEW_SESSION, PREVIEW_TRADES, previewAccount, previewDrawings, previewSourceBars } from "@/lib/market-replay/chart-style-preview-data";
import type { ReplayViewportApi, ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";
import { ReplayChart, type ReplayVisibleSequenceRange } from "./replay-chart";
import { ChartStyleSettingsDialog } from "./chart-style-settings-dialog";
import { ReplayDrawingToolbar } from "./replay-drawing-toolbar";
import { useReplayPreferences } from "./use-replay-preferences";

export function ChartStylePreview() {
  const t = copy.marketReplay.chartPreview;
  const { mode, setMode } = useAppearance();
  const prefs = useReplayPreferences(PREVIEW_DATASET);
  const [draft, setDraft] = useState<ChartDisplayConfig | null>(null);
  const config = draft ?? prefs.chartStyle;
  const [sequence, setSequence] = useState(121);
  const [pulse, setPulse] = useState(0);
  const [interval, setInterval] = useState(300);
  const [readOnly, setReadOnly] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [tool, setTool] = useState<DrawingTool | null>(null);
  const [measure, setMeasure] = useState(false);
  const [drawings, setDrawings] = useState(previewDrawings);
  const [selected, setSelected] = useState<string | null>("preview-trend");
  const [objects, setObjects] = useState(false);
  const [draftActive, setDraftActive] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [orders, setOrders] = useState(() => previewAccount(0, 100).activeOrders);
  const [holding, setHolding] = useState(true);
  const viewport = useRef<ReplayViewportApi | null>(null);
  const [view, setView] = useState<ReplayViewportSnapshot | null>(null);
  const [visibleRange, setVisibleRange] = useState<ReplayVisibleSequenceRange | null>(null);
  const source = useMemo(() => previewSourceBars(readOnly ? 399 : sequence, readOnly ? 0 : pulse), [readOnly, sequence, pulse]);
  const bars = useMemo(() => aggregateMarketBars({ bars: source, sourceSeconds: 60, displaySeconds: interval,
    session: PREVIEW_SESSION, currentSequence: readOnly ? 399 : sequence, finalSequence: 399, emissionMode: "DENSE" }), [source, sequence, interval, readOnly]);
  const [focus, setFocus] = useState<number | null>(null);
  const playback = useHistoricalPlayback({ endSequence: 399, seconds: interval, disabled: false,
    getTimeline: () => ({ bars, seconds: interval, session: "ETH" }), readLater: async () => [] });
  useWebFullscreen(fullscreen, () => setFullscreen(false), Boolean(tool || measure || selected));
  const lastClose = source.at(-1)!.close;
  const account = useMemo(() => {
    const snapshot = previewAccount(sequence, lastClose, orders);
    return holding ? snapshot : { ...snapshot, session: { ...snapshot.session, netQuantity: 0, averageEntryPrice: null },
      stats: { ...snapshot.stats, equity: 10000, unrealizedPnl: 0, netPnl: 0 } };
  }, [sequence, lastClose, orders, holding]);
  const onRange = useCallback((range: ReplayVisibleSequenceRange) => setVisibleRange(previous =>
    previous && JSON.stringify(previous) === JSON.stringify(range) ? previous : range), []);
  function addDrawing(type: TwoPointDrawingTool, geometry: TrendLineGeometry) {
    const base = { id: createUuid(), datasetId: PREVIEW_DATASET.id, geometry, createdAt: PREVIEW_DATASET.startTime, updatedAt: PREVIEW_DATASET.startTime };
    const drawing: MarketDrawing = type === "RECTANGLE" ? { ...base, type, style: DEFAULT_RECTANGLE_STYLE }
      : type === "FIB_RETRACEMENT" ? { ...base, type, style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE }
      : { ...base, type: "TREND_LINE", style: DEFAULT_TREND_LINE_STYLE };
    setDrawings(current => [...current, drawing]); setSelected(drawing.id); setTool(null);
  }
  return <section className={fullscreen ? "fixed inset-0 z-40 flex flex-col gap-3 bg-background p-3" : "flex h-[calc(100dvh-8rem)] min-h-[480px] flex-col gap-3"}>
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-foreground">{t.title}</h1>
        <Button variant="outline" aria-pressed={mode === "light"} onClick={() => setMode("light")}>{copy.appearance.light}</Button>
        <Button variant="outline" aria-pressed={mode === "dark"} onClick={() => setMode("dark")}>{copy.appearance.dark}</Button>
        <Button variant="outline" aria-pressed={!readOnly} onClick={() => { playback.engine.exit(); setReadOnly(false); }}>{t.live}</Button>
        <Button variant="outline" aria-pressed={readOnly} onClick={() => setReadOnly(true)}>{t.history}</Button>
        <Button variant="outline" onClick={() => setFullscreen(value => !value)}>{fullscreen ? copy.marketReplay.exitWebFullscreen : copy.marketReplay.enterWebFullscreen}</Button>
      </div>
      <p className="text-xs text-secondary-text">{t.hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDraft(cloneChartDisplay(prefs.chartStyle))}><ChartCandlestick className="h-4 w-4" aria-hidden="true" />{copy.marketReplay.chartStyle}</Button>
        <Button variant="outline" disabled={readOnly || sequence >= 399} onClick={() => { setSequence(value => value + 1); setPulse(0); }}>{t.advance}</Button>
        <Button variant="outline" disabled={readOnly} onClick={() => setPulse(value => value + 1)}>{t.forming}</Button>
        <Label htmlFor="preview-interval">{t.interval}</Label>
        <Select value={String(interval)} onValueChange={value => { playback.engine.pause(); setInterval(Number(value)); }}>
          <SelectTrigger id="preview-interval" className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{[60, 300, 900].map(seconds => <SelectItem key={seconds} value={String(seconds)}>{seconds / 60}m</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={() => viewport.current?.panByBars?.(-12)}>{t.pan}</Button>
        <Button variant="outline" onClick={() => viewport.current?.resetView?.()}>{t.reset}</Button>
        <Button variant="outline" onClick={() => setView(viewport.current?.capture(sequence, !readOnly) ?? null)}>{t.inspect}</Button>
      </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
    <div className="flex min-h-0 flex-1">
      <ReplayDrawingToolbar cursorMode="crosshair" onCursorChange={() => {}} drawingTool={tool}
        onArmDrawing={next => setTool(current => current === next ? null : next)}
        measurementArmed={measure} onToggleMeasurement={() => setMeasure(value => !value)}
        drawingObjectsOpen={objects} onToggleDrawingObjects={() => setObjects(value => !value)}
        webFullscreen={fullscreen} onToggleWebFullscreen={() => setFullscreen(value => !value)} />
      <div className="min-w-0 flex-1">
        <ReplayChart datasetId={PREVIEW_DATASET.id} dataRevision="synthetic-source" priceTickSize={0.25}
          bars={bars} warmupBars={[]} displayUtcOffsetMinutes={0} displayIntervalSeconds={interval} sourceIntervalSeconds={60}
          hiddenAfter={readOnly ? playback.boundary : undefined} onHiddenAfterChange={readOnly ? playback.engine.hide : undefined}
          historicalPlaybackActive={readOnly && playback.active}
          onStartHistoricalPlayback={readOnly ? target => { playback.engine.start(target); setFocus(target.bar.lastSequence); } : undefined}
          focusSequence={focus} onFocusApplied={() => setFocus(null)}
          currentSourceSequence={playback.active ? playback.boundary?.bar.lastSequence : sequence} currentSourceTimestamp={source.at(-1)!.timestamp} liveWindow={!readOnly}
          candlestickStyle={config.candlestickStyle} chartDisplay={config}
          viewportApiRef={viewport} measurementArmed={measure} onMeasurementArmedChange={setMeasure}
          rectangleDraftStyle={DEFAULT_RECTANGLE_STYLE} trendLineDraftStyle={DEFAULT_TREND_LINE_STYLE}
          fibonacciDraftStyle={DEFAULT_FIBONACCI_RETRACEMENT_STYLE} drawingTool={tool} onDrawingToolChange={setTool}
          drawings={drawings} selectedDrawingId={selected} onSelectedDrawingIdChange={setSelected} onCreateDrawing={addDrawing}
          onUpdateDrawing={(id, geometry) => setDrawings(current => current.map(drawing => drawing.id === id ? { ...drawing, geometry } as MarketDrawing : drawing))}
          onDeleteDrawing={id => setDrawings(current => current.filter(drawing => drawing.id !== id))} onOpenDrawingStyle={() => {}}
          onPlaceText={anchor => {
            const id = createUuid(); setDrawings(current => [...current, { id, datasetId: PREVIEW_DATASET.id, type: "TEXT",
              geometry: { anchor, text: t.text }, style: DEFAULT_TEXT_STYLE, createdAt: PREVIEW_DATASET.startTime, updatedAt: PREVIEW_DATASET.startTime }]);
            setSelected(id); setTool(null);
          }}
          onPlaceArrow={(type, anchor) => {
            const id = createUuid(); setDrawings(current => [...current, { id, datasetId: PREVIEW_DATASET.id, type,
              geometry: { anchor }, style: DEFAULT_ARROW_STYLES[type], createdAt: PREVIEW_DATASET.startTime, updatedAt: PREVIEW_DATASET.startTime }]);
            setSelected(id); setTool(null);
          }}
          onCreateAbcd={geometry => {
            const id = createUuid(); setDrawings(current => [...current, { id, datasetId: PREVIEW_DATASET.id, type: "AB_CD",
              geometry, style: DEFAULT_ABCD_STYLE, createdAt: PREVIEW_DATASET.startTime, updatedAt: PREVIEW_DATASET.startTime }]);
            setSelected(id); setTool(null);
          }}
          emaEnabled emaIndicators={[{ id: "preview-ema", length: 5, color: "#F59E0B", lineWidth: 1, lineStyle: "SOLID", visible: true }]}
          abrEnabled abrLength={8} volumeVisible gridVisible displaySession="ETH" barCountSession={PREVIEW_SESSION} barCountConfig={prefs.barCountConfig}
          paperSnapshot={readOnly ? null : account} tradeAnnotations={PREVIEW_TRADES} tradeAnnotationsTruncated={false} readOnly={readOnly}
          paperBusy={false} paperError={null}
          onSubmitOrder={async order => {
            setOrders(current => [...current, { ...previewAccount(0, 100).activeOrders[0], ...order, id: createUuid() }]); return true;
          }}
          onOrderPriceChange={async (id, update) => { setOrders(current => current.map(order => order.id === id ? { ...order, ...update } : order)); return true; }}
          onCancelOrder={async id => { setOrders(current => current.filter(order => order.id !== id)); return true; }}
          onClosePosition={async () => { setHolding(false); return true; }}
          onDraftActiveChange={setDraftActive} onDraftIdentityChange={setDraftId} onOpenPaperAccount={() => {}}
          onVisibleSequenceRangeChange={onRange} />
      </div>
      {objects ? <div className="w-48 space-y-2 overflow-y-auto border-l p-2">
        {drawings.map(drawing => <Button key={drawing.id} variant={selected === drawing.id ? "secondary" : "outline"} className="w-full" onClick={() => setSelected(drawing.id)}>{drawing.id}</Button>)}
      </div> : null}
    </div>
      <HistoricalPlaybackBar playback={playback} seconds={interval} onToggle={playback.engine.toggle}
        onNext={() => void playback.engine.step()} onRate={playback.engine.setRate} onExit={playback.engine.exit} />
    </div>
    <details className="shrink-0 rounded-md border bg-card p-2 text-xs" open>
      <summary>{t.diagnostics}</summary>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 tabular-nums">
        <span>{t.progress}: <output data-preview-sequence>{sequence}</output></span>
        <span>{t.close}: <output data-preview-close>{formatQuantity(lastClose)}</output></span>
        <span>{t.point}: <output data-preview-point>{formatQuantity(bars.at(-1)![config.line.priceSource])}</output></span>
        <span>{t.pnl}: <output data-preview-pnl>{formatQuantity(account.stats.unrealizedPnl)}</output></span>
        <span>{t.selected}: <output>{selected}</output></span>
        <span>{t.draft}: <output>{draftActive ? draftId : copy.common.dash}</output></span>
      </div>
      <pre className="max-h-20 overflow-auto pt-1" data-preview-config>{JSON.stringify({ preview: config, saved: prefs.chartStyle, view, visibleRange })}</pre>
    </details>
    <ChartStyleSettingsDialog open={draft !== null} draft={draft} onDraftChange={setDraft}
      onClose={() => setDraft(null)} onConfirm={next => { prefs.setChartStyle(next); setDraft(null); }} />
  </section>;
}
