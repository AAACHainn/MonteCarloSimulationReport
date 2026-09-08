"use client";

import { TZDate } from "@date-fns/tz";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2, Pause, Play, Plus, RotateCcw, Settings2, WalletCards, X } from "lucide-react";
import { ReplayChart } from "@/components/market-replay/replay-chart";
import { DEFAULT_REPLAY_MAX_VISIBLE_BARS } from "@/lib/market-replay/chart-range";
import { PaperAccountStrip, PaperTradingDetails, PaperTradingPanel } from "@/components/market-replay/paper-trading-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import {
  createReplayState,
  calculatePlaybackAdvance,
  pauseReplay,
  playReplay,
  resetReplay,
  setDisplayInterval,
  setDisplaySession,
  setPlaybackRate,
} from "@/lib/market-replay/engine";
import { getAggregationBucket, mergeSourceBar } from "@/lib/market-replay/aggregation";
import { MarketBarCache, ReplayWindowMemoryCache } from "@/lib/market-replay/bar-cache";
import { tradingDayForTimestamp } from "@/lib/market-replay/chunks";
import { datasetSession } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import {
  UTC_OFFSET_OPTIONS,
  formatUtcDateTime,
  formatUtcOffset,
  isSupportedUtcOffsetMinutes,
  utcOffsetMinutesForTimezone,
} from "@/lib/market-replay/display-timezone";
import {
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  MAX_EMA_INDICATORS,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  formatInterval,
  isValidDisplayInterval,
  type AggregatedMarketBarData,
  type EmaIndicatorConfig,
  type DisplaySession,
  type MarketBarData,
  type MarketDatasetSummary,
  type ReplayState,
} from "@/lib/market-replay/types";
import type { PaperOrderType, PaperSessionSnapshot, PaperSide } from "@/lib/paper-trading/types";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { applySpeculativeAdvance, paperCheckpointFingerprint } from "@/lib/paper-trading/speculative";
import {
  buildPaperReplayDelta,
  createPaperDeltaAccumulator,
  recordPaperAdvance,
  type PaperDeltaAccumulator,
  type ReplaySyncReceipt,
  type ReplaySyncRequest,
} from "@/lib/market-replay/client-sync";

import { useReplayState } from "@/lib/market-replay/use-replay-state";
import { createReplayStepQueue } from "@/lib/market-replay/step-queue";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type WindowPayload = {
  visibleBars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  lastSourceBar: MarketBarData | null;
};
type ServerAdvancePayload = {
  currentSequence: number;
  reachedVisibleBucket: boolean;
  lastSourceBar: MarketBarData | null;
  snapshot: PaperSessionSnapshot | null;
  generation: number;
  syncVersion: number;
};

const EMA_SETTINGS_STORAGE_KEY = "market-replay-ema-settings-v1";
const DISPLAY_TIMEZONE_STORAGE_KEY = "market-replay-display-timezone-v1";
const EMA_COLORS = ["#f59e0b", "#2563eb", "#7c3aed", "#0f766e", "#e11d48"];
const DEFAULT_EMA_INDICATORS: EmaIndicatorConfig[] = [
  { id: "ema-default-20", length: 20, color: EMA_COLORS[0], visible: true },
  { id: "ema-default-60", length: 60, color: EMA_COLORS[1], visible: true },
  { id: "ema-default-200", length: 200, color: EMA_COLORS[2], visible: true },
];
const DISPLAY_INTERVAL_PRESETS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1_800, 2_700, 3_600, 7_200, 14_400, 21_600, 43_200, 86_400];
const REPLAY_SYNC_BATCH_SIZE = 100;
const REPLAY_SYNC_HARD_CAP = 200;

function replaySyncCapacity(state: ReplayState, sourceIntervalSeconds: number, syncing: boolean, latencyMs: number) {
  if (!syncing) return REPLAY_SYNC_BATCH_SIZE;
  const estimatedWaitMs = Math.min(1_000, Math.max(250, latencyMs * 1.5));
  const barsPerSecond = state.playbackRate / sourceIntervalSeconds;
  return Math.min(REPLAY_SYNC_HARD_CAP, REPLAY_SYNC_BATCH_SIZE + Math.ceil(barsPerSecond * estimatedWaitMs / 1_000));
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
        visible: typeof candidate.visible === "boolean" ? candidate.visible : true,
      }];
    });
    return { enabled: parsed.enabled, indicators };
  } catch {
    return null;
  }
}

function dateTimeLocalValue(value: string, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function selectedTimeToTimestamp(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return Number.NaN;
  return new TZDate(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] ?? 0), timezone,
  ).getTime();
}

function formatDatasetTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function MarketReplayClient({ dataset }: { dataset: MarketDatasetSummary }) {
  const [bars, setBars] = useState<AggregatedMarketBarData[]>([]);
  const [warmupBars, setWarmupBars] = useState<AggregatedMarketBarData[]>([]);
  const [currentSourceBar, setCurrentSourceBar] = useState<MarketBarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replay, setReplay, latestReplayRef] = useReplayState();
  const [startValue, setStartValue] = useState(() => dateTimeLocalValue(dataset.startTime, dataset.timezone));
  const [startError, setStartError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [confirmAction, setConfirmAction] = useState<"reset" | "change-start" | "paper-clear" | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"indicators" | "paper" | null>(null);
  const [emaEnabled, setEmaEnabled] = useState(false);
  const [emaIndicators, setEmaIndicators] = useState<EmaIndicatorConfig[]>(DEFAULT_EMA_INDICATORS);
  const [emaSettingsLoaded, setEmaSettingsLoaded] = useState(false);
  const [emaError, setEmaError] = useState<string | null>(null);
  const [customInterval, setCustomInterval] = useState("");
  const [customIntervalUnit, setCustomIntervalUnit] = useState<"s" | "m" | "h">("m");
  const [repairInterval, setRepairInterval] = useState("");
  const [paperSnapshot, setPaperSnapshot] = useState<PaperSessionSnapshot | null>(null);
  const [paperBusy, setPaperBusy] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [draftActive, setDraftActive] = useState(false);
  const [displayUtcOffsetMinutes, setDisplayUtcOffsetMinutes] = useState(() => (
    utcOffsetMinutesForTimezone(dataset.startTime, dataset.timezone)
  ));
  const [displayTimezoneLoaded, setDisplayTimezoneLoaded] = useState(false);
  const emaWarmupCount = emaEnabled
    ? Math.max(0, ...emaIndicators.filter((indicator) => indicator.visible).map((indicator) => indicator.length))
    : 0;
  const emaWarmupCountRef = useRef(emaWarmupCount);
  emaWarmupCountRef.current = emaWarmupCount;
  const previousEmaWarmupCountRef = useRef<number | null>(null);
  const manualStepsRef = useRef(createReplayStepQueue());
  const marketSession = useMemo(() => datasetSession(dataset), [dataset]);
  const displayMarketSession = useMemo(() => (
    resolveDisplaySession(dataset, replay?.displaySession ?? "ETH") ?? marketSession
  ), [dataset, marketSession, replay?.displaySession]);
  const marketCache = useMemo(() => new MarketBarCache(dataset), [dataset]);
  const windowCache = useRef(new ReplayWindowMemoryCache<WindowPayload>());
  const barsRef = useRef<AggregatedMarketBarData[]>([]);
  const currentSourceBarRef = useRef<MarketBarData | null>(null);
  const recoveryRequiredRef = useRef(false);
  const viewChangingRef = useRef(false);
  const windowRequestRef = useRef(0);
  const windowAbortRef = useRef<AbortController | null>(null);
  const pendingSaveRef = useRef<ReplayState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveAtRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const paperSnapshotRef = useRef<PaperSessionSnapshot | null>(null);
  const confirmedPaperSnapshotRef = useRef<PaperSessionSnapshot | null>(null);
  const paperSessionLoadedRef = useRef(false);
  const paperSessionLoadRef = useRef<Promise<void>>(Promise.resolve());
  const advancingRef = useRef(false);
  const advanceCompletionRef = useRef<Promise<void>>(Promise.resolve());
  const paperMutationActiveRef = useRef(false);
  const paperMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPaperMutationsRef = useRef(0);
  const playbackAccumulatorRef = useRef(0);
  const playbackClockRef = useRef(0);
  const bufferingRef = useRef(false);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const syncCompletionRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const lastSyncStartedAtRef = useRef(0);
  const syncLatencyMsRef = useRef(500);
  const syncRequestCounterRef = useRef(0);
  const paperDeltaAccumulatorRef = useRef<PaperDeltaAccumulator>(createPaperDeltaAccumulator(-1));

  const beginBuffering = useCallback(() => {
    if (bufferingRef.current || bufferingTimerRef.current) return;
    bufferingTimerRef.current = setTimeout(() => {
      bufferingTimerRef.current = null;
      if (bufferingRef.current) return;
      bufferingRef.current = true;
      setBuffering(true);
    }, 100);
  }, []);

  const endBuffering = useCallback(() => {
    if (bufferingTimerRef.current) {
      clearTimeout(bufferingTimerRef.current);
      bufferingTimerRef.current = null;
    }
    if (!bufferingRef.current) return;
    bufferingRef.current = false;
    setBuffering(false);
  }, []);

  useEffect(() => () => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    windowAbortRef.current?.abort();
  }, []);

  const commitPaperSnapshot = useCallback((snapshot: PaperSessionSnapshot | null) => {
    paperSnapshotRef.current = snapshot;
    setPaperSnapshot(snapshot);
  }, []);

  const commitConfirmedPaperSnapshot = useCallback((snapshot: PaperSessionSnapshot | null) => {
    confirmedPaperSnapshotRef.current = snapshot;
    commitPaperSnapshot(snapshot);
  }, [commitPaperSnapshot]);

  useEffect(() => { barsRef.current = bars; }, [bars]);
  useEffect(() => { currentSourceBarRef.current = currentSourceBar; }, [currentSourceBar]);

  useEffect(() => {
    const stored = loadEmaSettings();
    if (stored) {
      setEmaEnabled(stored.enabled);
      setEmaIndicators(stored.indicators);
    }
    setEmaSettingsLoaded(true);
  }, []);

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
      window.localStorage.setItem(EMA_SETTINGS_STORAGE_KEY, JSON.stringify({
        enabled: emaEnabled,
        indicators: emaIndicators,
      }));
    } catch {
      // Browser storage can be unavailable; EMA controls still work for the current page session.
    }
  }, [emaEnabled, emaIndicators, emaSettingsLoaded]);

  const loadWindow = useCallback(async (
    endSequence: number,
    displayIntervalSeconds: number,
    displaySession: DisplaySession,
    warmupCount: number,
    completedDisplayBucketStart: string | null = null,
  ) => {
    const requestId = ++windowRequestRef.current;
    windowAbortRef.current?.abort();
    windowAbortRef.current = null;
    const cacheKey = [
      dataset.id, dataset.dataVersion, endSequence, displayIntervalSeconds, displaySession,
      DEFAULT_REPLAY_MAX_VISIBLE_BARS, Math.min(EMA_LENGTH_MAX, warmupCount),
    ].join(":");
    const params = new URLSearchParams({
      displayIntervalSeconds: String(displayIntervalSeconds), displaySession, endSequence: String(endSequence),
      visibleCount: String(DEFAULT_REPLAY_MAX_VISIBLE_BARS), warmupCount: String(Math.min(EMA_LENGTH_MAX, warmupCount)),
    });
    let data = windowCache.current.get(cacheKey);
    if (!data) {
      const controller = new AbortController();
      windowAbortRef.current = controller;
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? copy.marketReplay.loadError);
        data = body as WindowPayload;
        windowCache.current.set(cacheKey, data);
      } catch (error) {
        if (controller.signal.aborted) return;
        throw error;
      } finally {
        if (windowAbortRef.current === controller) windowAbortRef.current = null;
      }
    }
    if (requestId !== windowRequestRef.current) return;
    const closeCompletedBucket = (bar: AggregatedMarketBarData) => (
      bar.timestamp === completedDisplayBucketStart
        ? { ...bar, status: bar.sourceCount === bar.expectedCount ? "COMPLETE" as const : "INCOMPLETE" as const }
        : bar
    );
    const visible = data.visibleBars.map(closeCompletedBucket);
    barsRef.current = visible;
    currentSourceBarRef.current = data.lastSourceBar;
    setBars(visible);
    setWarmupBars(data.warmupBars);
    setCurrentSourceBar(data.lastSourceBar);
    if (dataset.sourceIntervalSeconds) {
      const anchor = tradingDayForTimestamp(data.lastSourceBar?.timestamp ?? dataset.startTime, marketSession);
      marketCache.prefetch(anchor);
    }
  }, [dataset.dataVersion, dataset.id, dataset.sourceIntervalSeconds, dataset.startTime, marketCache, marketSession]);

  useEffect(() => {
    if (!emaSettingsLoaded) return;
    let cancelled = false;
    const initialize = async () => {
      if (!dataset.sourceIntervalSeconds) throw new Error(copy.marketReplay.invalidDisplayInterval);
      const response = await fetch(`/api/market-datasets/${dataset.id}/progress`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? copy.marketReplay.loadError);
      if (!cancelled) {
        commitConfirmedPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
        paperSessionLoadedRef.current = true;
        paperSessionLoadRef.current = Promise.resolve();
      }
      const progress = data.progress;
      if (progress) {
        const next = createReplayState(
          dataset.barCount, progress.startSequence, progress.playbackRate,
          progress.displayIntervalSeconds ?? dataset.sourceIntervalSeconds, progress.currentSequence,
          progress.generation, progress.syncVersion, progress.displaySession ?? "ETH",
        );
        if (!cancelled) setReplay(next);
        paperDeltaAccumulatorRef.current = createPaperDeltaAccumulator(next.currentSequence);
        lastSyncStartedAtRef.current = performance.now();
        await loadWindow(next.currentSequence, next.displayIntervalSeconds, next.displaySession, emaWarmupCountRef.current);
      }
    };
    initialize().catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : copy.marketReplay.loadError); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [commitConfirmedPaperSnapshot, dataset, emaSettingsLoaded, loadWindow, setReplay]);

  useEffect(() => {
    if (!emaSettingsLoaded) return;
    const previous = previousEmaWarmupCountRef.current;
    previousEmaWarmupCountRef.current = emaWarmupCount;
    if (previous === null || previous === emaWarmupCount) return;
    const current = latestReplayRef.current;
    if (!current) return;
    void loadWindow(
      current.currentSequence,
      current.displayIntervalSeconds,
      current.displaySession,
      emaWarmupCount,
    ).catch((error) => setEmaError(error instanceof Error ? error.message : copy.marketReplay.loadError));
  }, [emaSettingsLoaded, emaWarmupCount, latestReplayRef, loadWindow]);

  useEffect(() => { paperSnapshotRef.current = paperSnapshot; }, [paperSnapshot]);

  const reloadPaper = useCallback(async () => {
    const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.requestFailed);
    commitConfirmedPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
    paperSessionLoadedRef.current = true;
    paperDeltaAccumulatorRef.current = createPaperDeltaAccumulator(latestReplayRef.current?.confirmedSequence ?? -1);
    return data.snapshot as PaperSessionSnapshot | null;
  }, [commitConfirmedPaperSnapshot, dataset.id, latestReplayRef]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const next = pendingSaveRef.current;
    if (!next) return;
    pendingSaveRef.current = null;
    lastSaveAtRef.current = Date.now();
    setSaveStatus("saving");
    saveChainRef.current = saveChainRef.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/market-datasets/${dataset.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startSequence: next.startSequence,
          currentSequence: next.currentSequence,
          playbackRate: next.playbackRate,
          displayIntervalSeconds: next.displayIntervalSeconds,
          displaySession: next.displaySession,
        }),
      });
      if (!response.ok) throw new Error(copy.marketReplay.saveError);
      setSaveStatus("saved");
    }).catch(() => setSaveStatus("error"));
  }, [dataset.id]);

  const queueSave = useCallback((next: ReplayState, immediate: boolean) => {
    pendingSaveRef.current = next;
    if (immediate) {
      flushSave();
      return;
    }
    if (saveTimerRef.current) return;
    const delay = Math.max(0, 1_000 - (Date.now() - lastSaveAtRef.current));
    saveTimerRef.current = setTimeout(flushSave, delay);
  }, [flushSave]);

  const recoverReplay = useCallback(async () => {
    const visibleSequence = latestReplayRef.current?.currentSequence ?? -1;
    const response = await fetch(`/api/market-datasets/${dataset.id}/progress`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.advanceFailed);
    commitConfirmedPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
    const progress = data.progress;
    if (!progress) {
      setReplay(null); setBars([]); setWarmupBars([]); setCurrentSourceBar(null);
    } else {
      const next = createReplayState(dataset.barCount, progress.startSequence, progress.playbackRate,
        progress.displayIntervalSeconds ?? dataset.sourceIntervalSeconds!, progress.currentSequence,
        progress.generation, progress.syncVersion, progress.displaySession ?? "ETH");
      setReplay(next);
      await loadWindow(next.currentSequence, next.displayIntervalSeconds, next.displaySession, emaWarmupCountRef.current);
      setRecoveryNotice(visibleSequence > next.currentSequence ? copy.marketReplay.recoveredWithRollback(visibleSequence - next.currentSequence) : null);
    }
    recoveryRequiredRef.current = false;
    paperDeltaAccumulatorRef.current = createPaperDeltaAccumulator(progress?.currentSequence ?? -1);
    playbackAccumulatorRef.current = 0;
    playbackClockRef.current = performance.now();
  }, [commitConfirmedPaperSnapshot, dataset, latestReplayRef, loadWindow, setReplay]);

  const startSync = useCallback(async (keepalive = false, silent = false) => {
    if (!paperSessionLoadedRef.current) await paperSessionLoadRef.current;
    if (syncingRef.current) return syncCompletionRef.current;
    const current = latestReplayRef.current;
    if (!current || current.currentSequence <= current.confirmedSequence) return true;
    if (current.currentSequence - current.confirmedSequence > REPLAY_SYNC_BATCH_SIZE) {
      recoveryRequiredRef.current = true;
      setReplay((value) => value ? pauseReplay(value) : value);
      await recoverReplay();
      return false;
    }
    syncingRef.current = true;
    const checkpoint = paperSnapshotRef.current;
    const checkpointFingerprint = paperCheckpointFingerprint(checkpoint);
    const frozenAccumulator = paperDeltaAccumulatorRef.current;
    if (frozenAccumulator.fromSequence !== current.confirmedSequence
      || frozenAccumulator.toSequence !== current.currentSequence) {
      syncingRef.current = false;
      recoveryRequiredRef.current = true;
      setReplay((value) => value ? pauseReplay(value) : value);
      await recoverReplay();
      return false;
    }
    paperDeltaAccumulatorRef.current = createPaperDeltaAccumulator(current.currentSequence);
    const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${++syncRequestCounterRef.current}`;
    const requestBody: ReplaySyncRequest = {
      generation: current.generation,
      requestId,
      confirmedSequence: current.confirmedSequence,
      syncVersion: current.syncVersion,
      dataVersion: dataset.dataVersion,
      expectedPaperVersion: confirmedPaperSnapshotRef.current?.session.version ?? null,
      targetSequence: current.currentSequence,
      paperDelta: checkpoint ? buildPaperReplayDelta(frozenAccumulator, checkpoint) : null,
    };
    const startedAt = performance.now();
    lastSyncStartedAtRef.current = startedAt;
    const operation = (async () => {
      if (!silent) setSaveStatus("saving");
      let response: Response | null = null;
      let data: ReplaySyncReceipt & { error?: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetch(`/api/market-datasets/${dataset.id}/replay/sync`, {
            method: "POST", headers: { "Content-Type": "application/json" }, keepalive,
            body: JSON.stringify(requestBody),
          });
          data = await response.json();
          if (response.ok || response.status < 500) break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 150 : 400));
      }
      if (!response || !data || !response.ok) throw new Error(data?.error ?? copy.paperTrading.advanceFailed);
      if (data.dataVersion !== dataset.dataVersion || data.generation !== current.generation) {
        throw new Error(copy.marketReplay.cacheVersionConflict);
      }
      if (data.fingerprint !== checkpointFingerprint
        || data.paperVersion !== (checkpoint?.session.version ?? null)) {
        throw new Error(copy.marketReplay.syncMismatch);
      }
      confirmedPaperSnapshotRef.current = checkpoint;
      setReplay((value) => value ? {
        ...value,
        confirmedSequence: data.currentSequence,
        syncVersion: data.syncVersion,
      } : value);
      recoveryRequiredRef.current = false;
      const measuredLatency = performance.now() - startedAt;
      syncLatencyMsRef.current = syncLatencyMsRef.current * 0.7 + measuredLatency * 0.3;
      if (!silent) setSaveStatus("saved");
      setPaperError(null);
      return true;
    })().catch(async (error) => {
      recoveryRequiredRef.current = true;
      setReplay((value) => value ? pauseReplay(value) : value);
      setPaperError(error instanceof Error ? error.message : copy.paperTrading.advanceFailed);
      await advanceCompletionRef.current.catch(() => undefined);
      try { await recoverReplay(); } catch { /* A later action retries authoritative recovery. */ }
      return false;
    }).finally(() => {
      syncingRef.current = false;
    });
    syncCompletionRef.current = operation;
    return operation;
  }, [dataset.dataVersion, dataset.id, latestReplayRef, recoverReplay, setReplay]);

  const flushVisible = useCallback(async (keepalive = false) => {
    while (true) {
      if (syncingRef.current && !(await syncCompletionRef.current)) return false;
      const current = latestReplayRef.current;
      if (!current || current.currentSequence <= current.confirmedSequence) return true;
      if (!(await startSync(keepalive))) return false;
    }
  }, [latestReplayRef, startSync]);

  const fastForwardToNextVisibleBar = useCallback(async () => {
    let current = latestReplayRef.current;
    if (!current || viewChangingRef.current || advancingRef.current || paperMutationActiveRef.current) return false;
    viewChangingRef.current = true;
    beginBuffering();
    try {
      await advanceCompletionRef.current;
      await paperMutationChainRef.current;
      if (!(await flushVisible())) return false;
      current = latestReplayRef.current;
      if (!current) return false;
      let next = current;
      let snapshot = confirmedPaperSnapshotRef.current;
      let lastSourceBar = currentSourceBarRef.current;
      let reachedVisibleBucket = false;
      for (let attempt = 0; attempt < 64 && next.currentSequence < next.barCount - 1; attempt += 1) {
        const response = await fetch(`/api/market-datasets/${dataset.id}/replay/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedCurrentSequence: next.currentSequence,
            expectedVersion: snapshot?.session.version ?? null,
            count: 1,
            displayIntervalSeconds: next.displayIntervalSeconds,
            displaySession: next.displaySession,
          }),
        });
        const data = await response.json() as ServerAdvancePayload & { error?: string };
        if (!response.ok) throw new Error(data.error ?? copy.paperTrading.advanceFailed);
        if (data.currentSequence <= next.currentSequence || data.generation !== next.generation) {
          throw new Error(copy.marketReplay.syncMismatch);
        }
        next = {
          ...next,
          currentSequence: data.currentSequence,
          confirmedSequence: data.currentSequence,
          syncVersion: data.syncVersion,
          status: data.currentSequence >= next.barCount - 1 ? "finished" : next.status,
        };
        snapshot = data.snapshot;
        lastSourceBar = data.lastSourceBar;
        reachedVisibleBucket = data.reachedVisibleBucket;
        if (reachedVisibleBucket) break;
      }
      commitConfirmedPaperSnapshot(snapshot);
      paperDeltaAccumulatorRef.current = createPaperDeltaAccumulator(next.currentSequence);
      currentSourceBarRef.current = lastSourceBar;
      setReplay(next);
      setCurrentSourceBar(lastSourceBar);
      await loadWindow(next.currentSequence, next.displayIntervalSeconds, next.displaySession, emaWarmupCountRef.current);
      setRecoveryNotice(null);
      return reachedVisibleBucket;
    } catch (error) {
      recoveryRequiredRef.current = true;
      setPaperError(error instanceof Error ? error.message : copy.paperTrading.advanceFailed);
      setReplay((value) => value ? pauseReplay(value) : value);
      try { await recoverReplay(); } catch { /* A later action retries authoritative recovery. */ }
      return false;
    } finally {
      endBuffering();
      viewChangingRef.current = false;
    }
  }, [beginBuffering, commitConfirmedPaperSnapshot, dataset.id, endBuffering, flushVisible, latestReplayRef, loadWindow, recoverReplay, setReplay]);

  const processLocalBars = useCallback(async (requestedCount: number) => {
    const frameStartedAt = performance.now();
    let current = latestReplayRef.current;
    if (
      !current || advancingRef.current || paperMutationActiveRef.current || viewChangingRef.current
      || current.currentSequence >= current.barCount - 1 || !dataset.sourceIntervalSeconds
    ) return 0;
    const unconfirmedLimit = replaySyncCapacity(current, dataset.sourceIntervalSeconds, syncingRef.current, syncLatencyMsRef.current);
    const capacity = Math.max(0, unconfirmedLimit - (current.currentSequence - current.confirmedSequence));
    const count = Math.min(requestedCount, capacity, current.barCount - 1 - current.currentSequence);
    if (count <= 0) return 0;
    advancingRef.current = true;
    let resolveAdvance: () => void = () => undefined;
    advanceCompletionRef.current = new Promise<void>((resolve) => { resolveAdvance = resolve; });
    try {
      if (!paperSessionLoadedRef.current) {
        beginBuffering();
        await paperSessionLoadRef.current;
        endBuffering();
      }
      if (recoveryRequiredRef.current) {
        await recoverReplay();
        current = latestReplayRef.current;
        if (!current) return 0;
      }
      const anchor = tradingDayForTimestamp(
        currentSourceBarRef.current?.timestamp ?? dataset.startTime,
        marketSession,
      );
      let sourceBars = marketCache.readMemoryBarsAfter(current.currentSequence, count);
      if (sourceBars.length < count) {
        beginBuffering();
        try {
          sourceBars = await marketCache.getBarsAfter(current.currentSequence, count, anchor);
        } finally {
          endBuffering();
        }
      }
      if (!sourceBars.length) {
        if (current.currentSequence >= current.barCount - 1) {
          setReplay((value) => value ? { ...value, status: "finished" } : value);
        }
        return 0;
      }
      if (sourceBars[0].sequence !== current.currentSequence + 1) {
        throw new Error(copy.marketReplay.cacheGap);
      }
      sourceBars = sourceBars.slice(0, count);
      let aggregates = barsRef.current;
      let snapshot = paperSnapshotRef.current;
      for (const source of sourceBars) {
        aggregates = mergeSourceBar(aggregates, source, {
          sourceSeconds: dataset.sourceIntervalSeconds,
          displaySeconds: current.displayIntervalSeconds,
          session: displayMarketSession,
          finalSequence: dataset.barCount - 1,
        });
        if (snapshot) {
          if (snapshot.session.lastProcessedSequence !== source.sequence - 1) {
            throw new Error(copy.marketReplay.syncMismatch);
          }
          const result = advancePaperTrading({
            state: snapshot.session,
            orders: snapshot.activeOrders,
            bar: source,
            makeId: createDeterministicEventIdFactory(snapshot.session.id, current.generation, source.sequence),
          });
          const equitySampleStride = Math.max(1, Math.ceil(dataset.barCount / 20_000));
          recordPaperAdvance(
            paperDeltaAccumulatorRef.current,
            snapshot,
            result,
            result.fills.length > 0 || source.sequence === dataset.barCount - 1 || source.sequence % equitySampleStride === 0,
          );
          snapshot = applySpeculativeAdvance(snapshot, result);
        }
        paperDeltaAccumulatorRef.current.toSequence = source.sequence;
      }
      aggregates = aggregates.slice(-(DEFAULT_REPLAY_MAX_VISIBLE_BARS + EMA_LENGTH_MAX));
      barsRef.current = aggregates;
      const lastSourceBar = sourceBars.at(-1)!;
      currentSourceBarRef.current = lastSourceBar;
      paperSnapshotRef.current = snapshot;
      const currentSequence = lastSourceBar.sequence;
      startTransition(() => {
        setBars(aggregates);
        setCurrentSourceBar(lastSourceBar);
        if (snapshot) setPaperSnapshot(snapshot);
        setReplay((value) => value ? {
          ...value,
          currentSequence,
          status: currentSequence >= value.barCount - 1 ? "finished" : value.status,
        } : value);
        setRecoveryNotice(null);
      });
      return sourceBars.length;
    } catch (error) {
      endBuffering();
      recoveryRequiredRef.current = true;
      setPaperError(error instanceof Error ? error.message : copy.paperTrading.advanceFailed);
      setReplay((value) => value ? pauseReplay(value) : value);
      return 0;
    } finally {
      performance.measure("market-replay-source-frame", { start: frameStartedAt, end: performance.now() });
      advancingRef.current = false;
      resolveAdvance();
    }
  }, [beginBuffering, dataset.barCount, dataset.sourceIntervalSeconds, dataset.startTime, displayMarketSession, endBuffering, latestReplayRef, marketCache, marketSession, recoverReplay, setReplay]);

  const replayStatus = replay?.status;
  useEffect(() => {
    if (replayStatus !== "playing") return;
    let cancelled = false;
    let frame = 0;
    playbackClockRef.current = performance.now();
    const tick = async (now: number) => {
      const current = latestReplayRef.current;
      if (cancelled || !current || current.status !== "playing" || !dataset.sourceIntervalSeconds) return;
      const maximum = Math.max(0, replaySyncCapacity(
        current, dataset.sourceIntervalSeconds, syncingRef.current, syncLatencyMsRef.current,
      ) - (current.currentSequence - current.confirmedSequence));
      const elapsedMs = now - playbackClockRef.current;
      const advance = calculatePlaybackAdvance(playbackAccumulatorRef.current, elapsedMs,
        current.playbackRate, dataset.sourceIntervalSeconds, maximum);
      playbackClockRef.current = now;
      playbackAccumulatorRef.current = advance.accumulator;
      if (advance.count > 0) {
        let nextSource = marketCache.readMemoryBarsAfter(current.currentSequence, 1)[0];
        if (!nextSource) {
          const anchor = tradingDayForTimestamp(
            currentSourceBarRef.current?.timestamp ?? dataset.startTime,
            marketSession,
          );
          nextSource = (await marketCache.getBarsAfter(current.currentSequence, 1, anchor))[0];
        }
        const nextBucket = nextSource ? getAggregationBucket(
          new Date(nextSource.timestamp).getTime(),
          dataset.sourceIntervalSeconds,
          current.displayIntervalSeconds,
          displayMarketSession,
        ) : undefined;
        if (nextSource && !nextBucket) {
          await fastForwardToNextVisibleBar();
          playbackAccumulatorRef.current = 0;
          playbackClockRef.current = performance.now();
        } else {
          const processed = await processLocalBars(advance.count);
          playbackAccumulatorRef.current += Math.max(0, advance.count - processed);
        }
      }
      const latest = latestReplayRef.current;
      if (latest && latest.currentSequence > latest.confirmedSequence && (
        now - lastSyncStartedAtRef.current >= 1_000
      )) {
        void startSync(false, true);
      }
      if (!cancelled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [dataset.sourceIntervalSeconds, dataset.startTime, displayMarketSession, fastForwardToNextVisibleBar, latestReplayRef, marketCache, marketSession, processLocalBars, replayStatus, startSync]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.visibilityState !== "hidden") return;
      manualStepsRef.current.cancel();
      setReplay((current) => current?.status === "playing" ? pauseReplay(current) : current);
      void advanceCompletionRef.current.then(() => flushVisible());
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [flushVisible, setReplay]);

  useEffect(() => {
    const manualSteps = manualStepsRef.current;
    const persistLatest = () => {
      const current = latestReplayRef.current;
      if (!current) return;
      void startSync(true, true);
      void fetch(`/api/market-datasets/${dataset.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startSequence: current.startSequence, currentSequence: current.currentSequence, playbackRate: current.playbackRate, displayIntervalSeconds: current.displayIntervalSeconds, displaySession: current.displaySession }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", persistLatest);
    return () => {
      window.removeEventListener("pagehide", persistLatest);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      manualSteps.cancel();
      windowRequestRef.current += 1;
      persistLatest();
    };
  }, [dataset.id, latestReplayRef, startSync]);

  async function beginReplay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dataset.sourceIntervalSeconds) return setStartError(copy.marketReplay.invalidDisplayInterval);
    const response = await fetch(`/api/market-datasets/${dataset.id}/replay/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: new Date(selectedTimeToTimestamp(startValue, dataset.timezone)).toISOString(), playbackRate: 1, displayIntervalSeconds: dataset.sourceIntervalSeconds, displaySession: "ETH" }),
    });
    const data = await response.json();
    if (!response.ok) return setStartError(data?.error ?? copy.marketReplay.invalidStart);
    const next = createReplayState(dataset.barCount, data.startSequence, data.playbackRate, data.displayIntervalSeconds, data.currentSequence, data.generation, data.syncVersion, data.displaySession ?? "ETH");
    next.confirmedSequence = data.currentSequence;
    paperDeltaAccumulatorRef.current = createPaperDeltaAccumulator(data.currentSequence);
    lastSyncStartedAtRef.current = performance.now();
    setStartError(null); setReplay(next);
    await loadWindow(next.currentSequence, next.displayIntervalSeconds, next.displaySession, emaWarmupCountRef.current);
  }

  function togglePlayback() {
    const current = latestReplayRef.current;
    if (!current || viewChangingRef.current) return;
    manualStepsRef.current.cancel();
    const next = current.status === "playing" ? pauseReplay(current) : playReplay(current);
    setReplay(next);
    if (next.status !== "playing") {
      void advanceCompletionRef.current.then(async () => {
        await flushVisible();
        queueSave(latestReplayRef.current ?? next, true);
      });
    } else {
      playbackClockRef.current = performance.now();
      lastSyncStartedAtRef.current = performance.now();
    }
  }

  const revealNextBar = useCallback(() => {
    const current = latestReplayRef.current;
    if (!current || current.status === "playing" || current.status === "finished") return;
    void manualStepsRef.current.enqueue(async () => {
      await advanceCompletionRef.current;
      await paperMutationChainRef.current;
      const latest = latestReplayRef.current;
      if (!latest || latest.status !== "paused" || viewChangingRef.current) return;
      if (!(await flushVisible())) return;
      const anchor = tradingDayForTimestamp(
        currentSourceBarRef.current?.timestamp ?? dataset.startTime,
        marketSession,
      );
      const first = (await marketCache.getBarsAfter(latest.currentSequence, 1, anchor))[0];
      if (!first || !dataset.sourceIntervalSeconds) return;
      const targetBucket = getAggregationBucket(
        new Date(first.timestamp).getTime(),
        dataset.sourceIntervalSeconds,
        latest.displayIntervalSeconds,
        displayMarketSession,
      );
      if (!targetBucket) {
        await fastForwardToNextVisibleBar();
        return;
      }
      while (true) {
        const current = latestReplayRef.current;
        if (!current || current.currentSequence >= current.barCount - 1) break;
        const currentAnchor = tradingDayForTimestamp(
          currentSourceBarRef.current?.timestamp ?? first.timestamp,
          marketSession,
        );
        const candidates = await marketCache.getBarsAfter(current.currentSequence, 100, currentAnchor);
        const inBucket = candidates.filter((bar) => {
          const bucket = getAggregationBucket(
            new Date(bar.timestamp).getTime(),
            dataset.sourceIntervalSeconds!,
            current.displayIntervalSeconds,
            displayMarketSession,
          );
          return bucket?.start === targetBucket.start;
        });
        if (!inBucket.length) break;
        const processed = await processLocalBars(inBucket.length);
        if (!processed || !(await flushVisible())) break;
        if (processed < inBucket.length || inBucket.length < candidates.length) break;
      }
    });
  }, [dataset.sourceIntervalSeconds, dataset.startTime, displayMarketSession, fastForwardToNextVisibleBar, flushVisible, latestReplayRef, marketCache, marketSession, processLocalBars]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (settingsDialog || confirmAction || target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      revealNextBar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmAction, revealNextBar, settingsDialog]);

  function changeSpeed(value: number) {
    const current = latestReplayRef.current;
    if (!current) return;
    const next = setPlaybackRate(current, value);
    setReplay(next);
    queueSave(next, true);
  }

  async function changeDisplayInterval(value: number) {
    if (!latestReplayRef.current || !dataset.sourceIntervalSeconds || !isValidDisplayInterval(dataset.sourceIntervalSeconds, value)) {
      setEmaError(copy.marketReplay.invalidDisplayInterval); return;
    }
    if (viewChangingRef.current) return;
    viewChangingRef.current = true;
    manualStepsRef.current.cancel();
    try {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      const current = latestReplayRef.current;
      if (!current) return;
      playbackAccumulatorRef.current = 0;
      playbackClockRef.current = performance.now();
      const next = setDisplayInterval(current, value);
      setReplay(next); setEmaError(null); queueSave(next, true);
      await loadWindow(next.currentSequence, value, next.displaySession, emaWarmupCountRef.current);
    } catch (error) {
      recoveryRequiredRef.current = true;
      setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    } finally { viewChangingRef.current = false; }
  }

  async function changeChartSession(value: DisplaySession) {
    if (!latestReplayRef.current || !dataset.availableDisplaySessions.includes(value) || viewChangingRef.current) return;
    viewChangingRef.current = true;
    manualStepsRef.current.cancel();
    try {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      const current = latestReplayRef.current;
      if (!current) return;
      playbackAccumulatorRef.current = 0;
      playbackClockRef.current = performance.now();
      const next = setDisplaySession(current, value);
      setReplay(next);
      setEmaError(null);
      queueSave(next, true);
      await saveChainRef.current;
      await loadWindow(next.currentSequence, next.displayIntervalSeconds, value, emaWarmupCountRef.current);
    } catch (error) {
      recoveryRequiredRef.current = true;
      setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    } finally {
      viewChangingRef.current = false;
    }
  }

  function setEmaLength(id: string, value: number) {
    if (!isValidEmaLength(value)) {
      setEmaError(copy.marketReplay.emaLengthRange(EMA_LENGTH_MIN, EMA_LENGTH_MAX));
      return false;
    }
    setEmaIndicators((current) => current.map((indicator) => (
      indicator.id === id ? { ...indicator, length: value } : indicator
    )));
    setEmaError(null);
    return true;
  }

  function addEma() {
    if (emaIndicators.length >= MAX_EMA_INDICATORS) {
      setEmaError(copy.marketReplay.emaLimit(MAX_EMA_INDICATORS));
      return;
    }
    const preferredLengths = [20, 60, 200, 9, 12, 26, 50, 100];
    const length = preferredLengths.find((candidate) => !emaIndicators.some((item) => item.length === candidate)) ?? 20;
    setEmaIndicators((current) => [...current, {
      id: `ema-${Date.now()}`,
      length,
      color: EMA_COLORS[current.length % EMA_COLORS.length],
      visible: true,
    }]);
    setEmaError(null);
  }

  function requestConfirmation(action: "reset" | "change-start" | "paper-clear") {
    const current = latestReplayRef.current;
    if (!current) return;
    if (current.status === "playing") {
      const paused = pauseReplay(current);
      setReplay(paused);
    }
    setConfirmAction(action);
  }

  async function applyConfirmedAction() {
    if (!latestReplayRef.current || !confirmAction) return;
    manualStepsRef.current.cancel();
    await advanceCompletionRef.current;
    if (!(await flushVisible())) {
      setConfirmAction(null);
      return;
    }
    windowRequestRef.current += 1;
    if (confirmAction === "paper-clear") {
      const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`, { method: "DELETE" });
      if (!response.ok) setPaperError(copy.paperTrading.requestFailed);
      else { commitConfirmedPaperSnapshot(null); setPaperError(null); }
    } else {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      await saveChainRef.current.catch(() => undefined);
      const response = await fetch(`/api/market-datasets/${dataset.id}/replay/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: confirmAction === "reset" ? "RESET" : "CHANGE_START" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setSaveStatus("error");
        setConfirmAction(null);
        return;
      }
      commitConfirmedPaperSnapshot(null);
      if (confirmAction === "reset") {
        const current = latestReplayRef.current;
        if (!current) return;
        const reset = resetReplay(current);
        reset.generation = data.generation;
        reset.syncVersion = data.syncVersion;
        reset.confirmedSequence = data.currentSequence;
        setReplay(reset);
        await loadWindow(reset.currentSequence, reset.displayIntervalSeconds, reset.displaySession, emaWarmupCountRef.current);
      } else {
        setReplay(null); setBars([]); setWarmupBars([]); setCurrentSourceBar(null);
      }
      setSaveStatus("idle");
    }
    setConfirmAction(null);
  }

  async function mutatePaper(url: string, createInit: (version: number | null) => RequestInit) {
    pendingPaperMutationsRef.current += 1;
    setPaperBusy(true);
    setPaperError(null);
    const operation = paperMutationChainRef.current.catch(() => undefined).then(async () => {
      const wasPlaying = latestReplayRef.current?.status === "playing";
      if (wasPlaying) setReplay((current) => current ? pauseReplay(current) : current);
      manualStepsRef.current.cancel();
      paperMutationActiveRef.current = true;
      await advanceCompletionRef.current.catch(() => undefined);
      try {
        if (!(await flushVisible())) return false;
        const version = confirmedPaperSnapshotRef.current?.session.version ?? null;
        const response = await fetch(url, createInit(version));
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 409) await reloadPaper();
          throw new Error(data?.error ?? copy.paperTrading.requestFailed);
        }
        if (data.snapshot !== undefined) commitConfirmedPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
        if (wasPlaying) {
          setReplay((current) => current ? playReplay(current) : current);
          playbackClockRef.current = performance.now();
          lastSyncStartedAtRef.current = performance.now();
        }
        return true;
      } catch (error) {
        setPaperError(error instanceof Error ? error.message : copy.paperTrading.requestFailed);
        if (paperSnapshotRef.current) await reloadPaper().catch(() => undefined);
        return false;
      } finally {
        paperMutationActiveRef.current = false;
      }
    });
    paperMutationChainRef.current = operation.then(() => undefined, () => undefined);
    return operation.finally(() => {
      pendingPaperMutationsRef.current -= 1;
      if (pendingPaperMutationsRef.current === 0) setPaperBusy(false);
    });
  }

  async function createPaperAccount(config: { initialCapital: number; currency: string; commissionBps: number; slippageBps: number }) {
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session`, () => ({
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
    }));
  }

  async function submitPaperOrder(order: { side: PaperSide; type: PaperOrderType; quantity: number; riskAmount?: number | null; price: number | null; stopLoss: number | null; takeProfit: number | null; reduceOnly?: boolean }) {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, (version) => ({
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...order, expectedVersion: version }),
    }));
  }

  async function updatePaperOrder(orderId: string, update: { price?: number; quantity?: number; stopLoss?: number | null; takeProfit?: number | null; riskAmount?: number | null }) {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders/${orderId}`, (version) => ({
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...update, expectedVersion: version }),
    }));
  }

  async function cancelPaperOrder(orderId: string) {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders/${orderId}`, (version) => ({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version }),
    }));
  }

  async function cancelPaperScope(scope: "ALL" | "BRACKET") {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, (version) => ({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, scope }),
    }));
  }

  async function closePaperPosition() {
    const quantity = Math.abs(paperSnapshotRef.current?.session.netQuantity ?? 0);
    if (quantity <= 0) return false;
    return submitPaperOrder({
      side: Number(paperSnapshotRef.current?.session.netQuantity) > 0 ? "SELL" : "BUY",
      type: "MARKET",
      quantity,
      price: null,
      stopLoss: null,
      takeProfit: null,
      reduceOnly: true,
    });
  }

  const currentBar = replay && replay.currentSequence >= 0 ? currentSourceBar : null;
  const revealedCount = replay ? Math.max(0, replay.currentSequence - replay.startSequence + 1) : 0;
  const replayCount = replay ? replay.barCount - replay.startSequence : 0;
  const statusText = useMemo(() => {
    if (buffering) return copy.marketReplay.buffering;
    if (recoveryNotice) return recoveryNotice;
    if (saveStatus === "saving") return copy.marketReplay.saving;
    if (saveStatus === "error") return copy.marketReplay.saveError;
    return saveStatus === "saved" ? copy.marketReplay.saved : "";
  }, [buffering, recoveryNotice, saveStatus]);

  if (!dataset.sourceIntervalSeconds) return (
    <Card className="max-w-xl"><CardHeader><CardTitle>{copy.marketReplay.repairMetadata}</CardTitle><CardDescription>{copy.marketReplay.repairMetadataDescription}</CardDescription></CardHeader>
      <CardContent className="space-y-3"><Label htmlFor="repair-source-interval">{copy.marketReplay.sourceInterval}</Label><Input id="repair-source-interval" type="number" min="1" max="86400" value={repairInterval} onChange={(event) => setRepairInterval(event.target.value)} />
        <Button type="button" onClick={async () => {
          const response = await fetch(`/api/market-datasets/${dataset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceIntervalSeconds: Number(repairInterval), sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: [1,2,3,4,5,6,7] }) });
          const data = await response.json().catch(() => null); if (!response.ok) setLoadError(data?.error ?? copy.marketReplay.loadError); else window.location.reload();
        }}>{copy.marketReplay.saveMetadata}</Button>{loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}</CardContent></Card>
  );

  if (isLoading) return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin" />{copy.marketReplay.loading}</div>;
  if (loadError) return <Alert className="border-red-200 bg-red-50"><AlertTitle>{copy.marketReplay.loadError}</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>;

  if (!replay) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <p className="font-mono text-xs uppercase tracking-wide text-blue-700">{copy.marketReplay.setupEyebrow}</p>
          <CardTitle>{copy.marketReplay.setupTitle}</CardTitle>
          <CardDescription>{copy.marketReplay.setupDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={beginReplay} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="replay-start">{copy.marketReplay.startAt}</Label>
              <Input
                id="replay-start"
                type="datetime-local"
                step="1"
                required
                min={dateTimeLocalValue(dataset.startTime, dataset.timezone)}
                max={dateTimeLocalValue(dataset.endTime, dataset.timezone)}
                value={startValue}
                onChange={(event) => setStartValue(event.target.value)}
              />
              <p className="text-xs text-slate-500">{dataset.timezone} · {formatDatasetTime(dataset.startTime, dataset.timezone)} – {formatDatasetTime(dataset.endTime, dataset.timezone)}</p>
            </div>
            {startError ? <p className="text-sm text-red-600">{startError}</p> : null}
            <Button type="submit"><Settings2 className="h-4 w-4" />{copy.marketReplay.begin}</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-white shadow-sm">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Label htmlFor="display-interval" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displayInterval}</Label>
          <Select value={String(replay.displayIntervalSeconds)} onValueChange={(value) => void changeDisplayInterval(Number(value))}>
            <SelectTrigger id="display-interval" className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DISPLAY_INTERVAL_PRESETS.filter((value) => dataset.sourceIntervalSeconds && isValidDisplayInterval(dataset.sourceIntervalSeconds, value)).map((value) => <SelectItem key={value} value={String(value)}>{formatInterval(value)}</SelectItem>)}
              {!DISPLAY_INTERVAL_PRESETS.includes(replay.displayIntervalSeconds) ? <SelectItem value={String(replay.displayIntervalSeconds)}>{formatInterval(replay.displayIntervalSeconds)}</SelectItem> : null}
            </SelectContent>
          </Select>
          {dataset.availableDisplaySessions.length > 1 ? (
            <>
              <Label htmlFor="display-session" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displaySession}</Label>
              <Select value={replay.displaySession} onValueChange={(value) => void changeChartSession(value as DisplaySession)}>
                <SelectTrigger id="display-session" className="h-8 w-20" title={copy.marketReplay.displaySessionHint}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETH">{copy.marketReplay.displaySessionEth}</SelectItem>
                  <SelectItem value="RTH">{copy.marketReplay.displaySessionRth}</SelectItem>
                </SelectContent>
              </Select>
            </>
          ) : null}
          <div className="hidden items-center gap-1 2xl:flex">
            <Input aria-label={copy.marketReplay.customInterval} type="number" min="1" value={customInterval} onChange={(event) => setCustomInterval(event.target.value)} className="h-8 w-16" placeholder="9" />
            <Select value={customIntervalUnit} onValueChange={(value) => setCustomIntervalUnit(value as "s" | "m" | "h")}>
              <SelectTrigger className="h-8 w-20" aria-label={copy.marketReplay.intervalUnit}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="s">{copy.marketReplay.intervalSeconds}</SelectItem><SelectItem value="m">{copy.marketReplay.intervalMinutes}</SelectItem><SelectItem value="h">{copy.marketReplay.intervalHours}</SelectItem></SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => {
              const multiplier = customIntervalUnit === "s" ? 1 : customIntervalUnit === "m" ? 60 : 3_600;
              void changeDisplayInterval(Number(customInterval) * multiplier);
            }}>{copy.marketReplay.customInterval}</Button>
          </div>
          <Label htmlFor="display-timezone" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displayTimezone}</Label>
          <Select value={String(displayUtcOffsetMinutes)} onValueChange={(value) => setDisplayUtcOffsetMinutes(Number(value))}>
            <SelectTrigger id="display-timezone" className="h-8 w-28" title={copy.marketReplay.displayTimezoneHint}><SelectValue /></SelectTrigger>
            <SelectContent
              position="popper"
              sideOffset={4}
              align="end"
              collisionPadding={8}
              className="max-h-72 w-40"
            >
              {UTC_OFFSET_OPTIONS.map((offset) => <SelectItem key={offset} value={String(offset)}>{formatUtcOffset(offset)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setSettingsDialog("indicators")}><Settings2 className="h-4 w-4" />{copy.marketReplay.indicators}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setSettingsDialog("paper")}><WalletCards className="h-4 w-4" />{copy.marketReplay.accountSettings}</Button>
          {paperSnapshot ? <div className="hidden items-center gap-3 text-xs text-slate-500 xl:flex"><span>{copy.paperTrading.equity} <strong className="font-medium text-slate-800">{paperSnapshot.stats.equity.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} {paperSnapshot.session.currency}</strong></span><span>{copy.paperTrading.netPosition} <strong className="font-medium text-slate-800">{paperSnapshot.session.netQuantity}</strong></span></div> : null}
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={draftActive} title={draftActive ? copy.paperTrading.draftLockedReplay : undefined} onClick={() => requestConfirmation("reset")}><RotateCcw className="h-4 w-4" /><span className="hidden xl:inline">{copy.marketReplay.reset}</span></Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={draftActive} title={draftActive ? copy.paperTrading.draftLockedReplay : undefined} onClick={() => requestConfirmation("change-start")}><span className="hidden xl:inline">{copy.marketReplay.chooseNewStart}</span><span className="xl:hidden">{copy.marketReplay.startAt}</span></Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ReplayChart
            datasetId={dataset.id}
            priceTickSize={dataset.priceTickSize}
            bars={bars}
            warmupBars={warmupBars}
            displayUtcOffsetMinutes={displayUtcOffsetMinutes}
            emaEnabled={emaEnabled}
            emaIndicators={emaIndicators}
            paperSnapshot={paperSnapshot}
            paperBusy={paperBusy}
            paperError={paperError}
            onSubmitOrder={submitPaperOrder}
            onOrderPriceChange={updatePaperOrder}
            onCancelOrder={cancelPaperOrder}
            onClosePosition={closePaperPosition}
            onDraftActiveChange={setDraftActive}
            onOpenPaperAccount={() => setSettingsDialog("paper")}
          />
        </div>
        <div className="flex h-14 shrink-0 items-center gap-2 border-t bg-slate-50/80 px-3">
          <Button type="button" size="sm" className="h-9" title={copy.marketReplay.playbackTiming(dataset.sourceIntervalSeconds / replay.playbackRate)} onClick={togglePlayback} disabled={replay.status === "finished"}>
            {replay.status === "playing" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{replay.status === "playing" ? copy.marketReplay.pause : copy.marketReplay.play}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={revealNextBar} disabled={replay.status === "finished" || replay.status === "playing"}>
            <ChevronRight className="h-4 w-4" />{copy.marketReplay.nextBar}<kbd className="ml-1 hidden rounded border bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 lg:inline">{copy.marketReplay.nextBarShortcut}</kbd>
          </Button>
          <PaperTradingDetails snapshot={paperSnapshot} />
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <Label htmlFor="replay-speed" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.speed}</Label>
          <Input id="replay-speed" type="range" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => changeSpeed(Number(event.target.value))} className="h-8 w-24 border-0 bg-transparent px-0 lg:w-32" />
          <Input aria-label={copy.marketReplay.speed} type="number" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => changeSpeed(Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Number(event.target.value))))} className="h-8 w-20" />
          <span className="text-xs font-medium text-slate-700">{copy.marketReplay.playbackRate(replay.playbackRate)}</span>
          <div className="ml-auto hidden items-center gap-4 text-xs xl:flex">
            <span className="text-slate-500">{copy.marketReplay.progress(revealedCount, replayCount)}</span>
            <span className="font-medium text-slate-800">{currentBar ? formatUtcDateTime(currentBar.timestamp, displayUtcOffsetMinutes) : copy.marketReplay.waiting}</span>
            <span className="hidden font-mono text-slate-600 2xl:inline">{currentBar ? `${currentBar.open} / ${currentBar.high} / ${currentBar.low} / ${currentBar.close}` : "–"}</span>
            <span className="font-medium text-slate-700">{replay.status === "playing" ? copy.marketReplay.play : replay.status === "finished" ? copy.marketReplay.finished : copy.marketReplay.pause}{statusText ? ` · ${statusText}` : ""}</span>
          </div>
        </div>
      </div>

      <Dialog open={settingsDialog === "indicators"} title={copy.marketReplay.indicatorSettings} description={copy.marketReplay.indicatorSettingsDescription} onClose={() => setSettingsDialog(null)}>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border bg-slate-50 p-3">
            <div><p className="text-sm font-medium text-slate-950">{copy.marketReplay.emaTitle}</p><p className="mt-0.5 text-xs text-slate-500">{copy.marketReplay.emaDescription}</p></div>
            <div className="flex items-center gap-2"><span className="text-xs text-slate-500">{emaEnabled ? copy.marketReplay.emaOn : copy.marketReplay.emaOff}</span><button type="button" role="switch" aria-checked={emaEnabled} aria-label={copy.marketReplay.emaMaster} onClick={() => setEmaEnabled((enabled) => !enabled)} className={`relative h-6 w-11 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${emaEnabled ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${emaEnabled ? "translate-x-5" : "translate-x-0.5"}`} /></button></div>
          </div>
          <div className="space-y-2">{emaIndicators.map((indicator) => <div key={indicator.id} className="flex h-11 items-center gap-3 rounded-md border px-3"><input type="checkbox" checked={indicator.visible} onChange={(event) => setEmaIndicators((current) => current.map((item) => item.id === indicator.id ? { ...item, visible: event.target.checked } : item))} aria-label={copy.marketReplay.emaLineToggle(indicator.length)} className="h-4 w-4 rounded border-slate-300" /><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: indicator.color }} aria-hidden="true" /><span className="w-12 text-sm font-medium text-slate-700">{copy.marketReplay.emaShortName}</span><Label htmlFor={`ema-length-${indicator.id}`} className="text-xs text-slate-500">{copy.marketReplay.emaLength}</Label><Input key={`${indicator.id}-${indicator.length}`} id={`ema-length-${indicator.id}`} type="number" min={EMA_LENGTH_MIN} max={EMA_LENGTH_MAX} step="1" defaultValue={indicator.length} onBlur={(event) => { if (!setEmaLength(indicator.id, Number(event.currentTarget.value))) event.currentTarget.value = String(indicator.length); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-8 w-24 font-mono text-xs" /><Button type="button" variant="ghost" size="icon" onClick={() => { setEmaIndicators((current) => current.filter((item) => item.id !== indicator.id)); setEmaError(null); }} aria-label={copy.marketReplay.emaRemove(indicator.length)} className="ml-auto h-8 w-8 text-slate-500"><X className="h-4 w-4" /></Button></div>)}</div>
          <Button type="button" variant="outline" size="sm" onClick={addEma} disabled={emaIndicators.length >= MAX_EMA_INDICATORS}><Plus className="h-4 w-4" />{copy.marketReplay.emaAdd}</Button>
          {emaError ? <p className="text-xs text-red-600">{emaError}</p> : null}
        </div>
      </Dialog>

      <Dialog open={settingsDialog === "paper"} title={copy.marketReplay.accountSettings} description={copy.marketReplay.accountSettingsDescription} className="max-w-3xl" onClose={() => setSettingsDialog(null)}>
        <div className="space-y-4">
          <PaperAccountStrip snapshot={paperSnapshot} />
          <PaperTradingPanel priceTickSize={dataset.priceTickSize} snapshot={paperSnapshot} currentBar={currentBar} busy={paperBusy} error={paperError} onCreate={createPaperAccount} onSubmit={submitPaperOrder} onCancel={cancelPaperOrder} onUpdate={updatePaperOrder} onCancelScope={cancelPaperScope} onClear={() => requestConfirmation("paper-clear")} />
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction === "reset" ? copy.marketReplay.resetTitle : confirmAction === "paper-clear" ? copy.paperTrading.resetAccountTitle : copy.marketReplay.changeStartTitle}
        description={confirmAction === "reset" ? copy.marketReplay.resetConfirm : confirmAction === "paper-clear" ? copy.paperTrading.resetAccountConfirm : copy.marketReplay.changeStartConfirm}
        onCancel={() => setConfirmAction(null)}
        onConfirm={applyConfirmedAction}
      />
    </>
  );
}
