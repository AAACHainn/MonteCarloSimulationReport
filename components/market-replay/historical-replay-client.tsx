"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ReplayChart } from "@/components/market-replay/replay-chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { copy } from "@/lib/i18n";
import { DEFAULT_BAR_COUNT_CONFIG } from "@/lib/market-replay/bar-count";
import { DEFAULT_CANDLESTICK_STYLE } from "@/lib/market-replay/candlestick-style";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import {
  DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
  DEFAULT_TREND_LINE_STYLE,
} from "@/lib/market-replay/chart-drawings";
import { datasetSession } from "@/lib/market-replay/dataset";
import { utcOffsetMinutesForTimezone } from "@/lib/market-replay/display-timezone";
import type {
  AggregatedMarketBarData,
  DisplaySession,
  MarketDatasetSummary,
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
  const annotationAbortRef = useRef<AbortController | null>(null);
  const displayUtcOffsetMinutes = useMemo(
    () => utcOffsetMinutesForTimezone(dataset.startTime, dataset.timezone),
    [dataset.startTime, dataset.timezone],
  );
  const barCountSession = useMemo(
    () => resolveDisplaySession(dataset, session.displaySession) ?? datasetSession(dataset),
    [dataset, session.displaySession],
  );

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
      warmupCount: "0",
    });
    void (async () => {
      setLoading(true);
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
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [dataset.id, focusSequence, loadAnnotations, session.displayIntervalSeconds, session.displaySession, session.endSequence, session.startSequence]);

  useEffect(() => () => {
    annotationAbortRef.current?.abort();
  }, []);

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

  return <ReplayChart
    datasetId={dataset.id}
    priceTickSize={dataset.priceTickSize}
    bars={bars}
    warmupBars={warmupBars}
    displayUtcOffsetMinutes={displayUtcOffsetMinutes}
    displayIntervalSeconds={session.displayIntervalSeconds}
    measurementArmed={false}
    candlestickStyle={DEFAULT_CANDLESTICK_STYLE}
    onMeasurementArmedChange={noOp}
    drawingTool={null}
    onDrawingToolChange={noOp}
    trendLineDraftStyle={DEFAULT_TREND_LINE_STYLE}
    fibonacciDraftStyle={DEFAULT_FIBONACCI_RETRACEMENT_STYLE}
    drawings={[]}
    selectedDrawingId={null}
    onSelectedDrawingIdChange={noOp}
    onCreateDrawing={noOp}
    onUpdateDrawing={noOp}
    onDeleteDrawing={noOp}
    onOpenDrawingStyle={noOp}
    emaEnabled={false}
    emaIndicators={[]}
    abrEnabled={false}
    abrLength={8}
    volumeVisible
    displaySession={session.displaySession}
    barCountSession={barCountSession}
    barCountConfig={DEFAULT_BAR_COUNT_CONFIG}
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
  />;
}
