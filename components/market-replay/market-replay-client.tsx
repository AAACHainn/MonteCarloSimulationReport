"use client";

import { TZDate } from "@date-fns/tz";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2, Pause, Play, Plus, RotateCcw, Settings2, WalletCards, X } from "lucide-react";
import { ReplayChart } from "@/components/market-replay/replay-chart";
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
  setPlaybackRate,
} from "@/lib/market-replay/engine";
import { mergeSourceBar } from "@/lib/market-replay/aggregation";
import { datasetSession } from "@/lib/market-replay/dataset";
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
  type MarketBarData,
  type MarketDatasetSummary,
  type ReplayState,
} from "@/lib/market-replay/types";
import type { PaperOrderType, PaperSessionSnapshot, PaperSide } from "@/lib/paper-trading/types";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const EMA_SETTINGS_STORAGE_KEY = "market-replay-ema-settings-v1";
const EMA_COLORS = ["#f59e0b", "#2563eb", "#7c3aed", "#0f766e", "#e11d48"];
const DEFAULT_EMA_INDICATORS: EmaIndicatorConfig[] = [
  { id: "ema-default-20", length: 20, color: EMA_COLORS[0], visible: true },
  { id: "ema-default-60", length: 60, color: EMA_COLORS[1], visible: true },
  { id: "ema-default-200", length: 200, color: EMA_COLORS[2], visible: true },
];
const DISPLAY_INTERVAL_PRESETS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1_800, 2_700, 3_600, 7_200, 14_400, 21_600, 43_200, 86_400];

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

function formatReplayTime(value: string, timezone: string) {
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
  const [replay, setReplay] = useState<ReplayState | null>(null);
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
  const [draftActive, setDraftActive] = useState(false);
  const latestReplayRef = useRef<ReplayState | null>(null);
  const pendingSaveRef = useRef<ReplayState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveAtRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const paperSnapshotRef = useRef<PaperSessionSnapshot | null>(null);
  const advancingRef = useRef(false);
  const advanceCompletionRef = useRef<Promise<void>>(Promise.resolve());
  const paperMutationActiveRef = useRef(false);
  const paperMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPaperMutationsRef = useRef(0);
  const playbackAccumulatorRef = useRef(0);
  const playbackClockRef = useRef(0);

  const commitPaperSnapshot = useCallback((snapshot: PaperSessionSnapshot | null) => {
    paperSnapshotRef.current = snapshot;
    setPaperSnapshot(snapshot);
  }, []);

  useEffect(() => {
    const stored = loadEmaSettings();
    if (stored) {
      setEmaEnabled(stored.enabled);
      setEmaIndicators(stored.indicators);
    }
    setEmaSettingsLoaded(true);
  }, []);

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
    warmupCount: number,
    completedDisplayBucketStart: string | null = null,
  ) => {
    const params = new URLSearchParams({
      displayIntervalSeconds: String(displayIntervalSeconds), endSequence: String(endSequence),
      visibleCount: "200", warmupCount: String(Math.min(EMA_LENGTH_MAX, warmupCount)),
    });
    const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? copy.marketReplay.loadError);
    const closeCompletedBucket = (bar: AggregatedMarketBarData) => (
      bar.timestamp === completedDisplayBucketStart
        ? { ...bar, status: bar.sourceCount === bar.expectedCount ? "COMPLETE" as const : "INCOMPLETE" as const }
        : bar
    );
    setBars((data.visibleBars as AggregatedMarketBarData[]).map(closeCompletedBucket));
    setWarmupBars(data.warmupBars as AggregatedMarketBarData[]);
    setCurrentSourceBar(data.lastSourceBar as MarketBarData | null);
  }, [dataset.id]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (!dataset.sourceIntervalSeconds) throw new Error(copy.marketReplay.invalidDisplayInterval);
      if (dataset.progress) {
        const next = createReplayState(
          dataset.barCount, dataset.progress.startSequence, dataset.progress.playbackRate,
          dataset.progress.displayIntervalSeconds, dataset.progress.currentSequence,
        );
        if (!cancelled) setReplay(next);
        await loadWindow(next.currentSequence, next.displayIntervalSeconds, EMA_LENGTH_MAX);
      }
    };
    initialize().catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : copy.marketReplay.loadError); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [dataset, loadWindow]);

  useEffect(() => { latestReplayRef.current = replay; }, [replay]);
  useEffect(() => { paperSnapshotRef.current = paperSnapshot; }, [paperSnapshot]);

  const reloadPaper = useCallback(async () => {
    const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.requestFailed);
    commitPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
    return data.snapshot as PaperSessionSnapshot | null;
  }, [commitPaperSnapshot, dataset.id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-datasets/${dataset.id}/paper-session`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.requestFailed);
        if (!cancelled) commitPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
      })
      .catch((error) => { if (!cancelled) setPaperError(error instanceof Error ? error.message : copy.paperTrading.requestFailed); });
    return () => { cancelled = true; };
  }, [commitPaperSnapshot, dataset.id]);

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

  const advanceBars = useCallback(async (count: number, keepPlaying: boolean, displayIntervalSeconds?: number) => {
    const current = latestReplayRef.current;
    if (!current || advancingRef.current || paperMutationActiveRef.current || current.currentSequence >= current.barCount - 1) return;
    advancingRef.current = true;
    let resolveAdvance: () => void = () => undefined;
    advanceCompletionRef.current = new Promise<void>((resolve) => { resolveAdvance = resolve; });
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/replay/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedCurrentSequence: current.currentSequence,
          expectedVersion: paperSnapshotRef.current?.session.version ?? null,
          count,
          displayIntervalSeconds,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) await reloadPaper();
        throw new Error(data?.error ?? copy.paperTrading.advanceFailed);
      }
      if (data.snapshot) commitPaperSnapshot(data.snapshot as PaperSessionSnapshot);
      const advancedBars = data.advancedBars as MarketBarData[];
      if (displayIntervalSeconds !== undefined) {
        await loadWindow(data.currentSequence, current.displayIntervalSeconds, EMA_LENGTH_MAX, data.completedDisplayBucketStart ?? null);
      } else if (advancedBars.length && dataset.sourceIntervalSeconds) {
        setCurrentSourceBar(advancedBars.at(-1)!);
        setBars((currentBars) => advancedBars.reduce((aggregates, source) => mergeSourceBar(aggregates, source, {
          sourceSeconds: dataset.sourceIntervalSeconds!, displaySeconds: current.displayIntervalSeconds,
          session: datasetSession(dataset), finalSequence: dataset.barCount - 1,
        }), currentBars).slice(-(200 + Math.max(...emaIndicators.map((item) => item.length), 0))));
      }
      setReplay((value) => value ? {
        ...value,
        currentSequence: data.currentSequence,
        status: data.currentSequence >= value.barCount - 1 ? "finished" : keepPlaying ? "playing" : "paused",
      } : value);
      setSaveStatus("saved");
      setPaperError(null);
    } catch (error) {
      setReplay((value) => value ? pauseReplay(value) : value);
      setPaperError(error instanceof Error ? error.message : copy.paperTrading.advanceFailed);
    } finally {
      advancingRef.current = false;
      resolveAdvance();
    }
  }, [commitPaperSnapshot, dataset, emaIndicators, loadWindow, reloadPaper]);

  const replayStatus = replay?.status;
  useEffect(() => {
    if (replayStatus !== "playing") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    playbackClockRef.current = performance.now();
    const tick = async () => {
      const current = latestReplayRef.current;
      if (cancelled || !current || current.status !== "playing" || !dataset.sourceIntervalSeconds) return;
      const now = performance.now();
      const advance = calculatePlaybackAdvance(playbackAccumulatorRef.current, now - playbackClockRef.current, current.playbackRate, dataset.sourceIntervalSeconds);
      playbackClockRef.current = now;
      const count = advance.count;
      if (count > 0) {
        playbackAccumulatorRef.current = advance.accumulator;
        await advanceBars(count, true);
      } else playbackAccumulatorRef.current = advance.accumulator;
      if (!cancelled) timer = setTimeout(tick, 100);
    };
    timer = setTimeout(tick, 100);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [advanceBars, dataset.sourceIntervalSeconds, replayStatus]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.visibilityState !== "hidden") return;
      setReplay((current) => current?.status === "playing" ? pauseReplay(current) : current);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);

  useEffect(() => {
    const persistLatest = () => {
      const current = latestReplayRef.current;
      if (!current) return;
      void fetch(`/api/market-datasets/${dataset.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startSequence: current.startSequence, currentSequence: current.currentSequence, playbackRate: current.playbackRate, displayIntervalSeconds: current.displayIntervalSeconds }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", persistLatest);
    return () => {
      window.removeEventListener("pagehide", persistLatest);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      persistLatest();
    };
  }, [dataset.id]);

  async function beginReplay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dataset.sourceIntervalSeconds) return setStartError(copy.marketReplay.invalidDisplayInterval);
    const response = await fetch(`/api/market-datasets/${dataset.id}/replay/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: new Date(selectedTimeToTimestamp(startValue, dataset.timezone)).toISOString(), playbackRate: 1, displayIntervalSeconds: dataset.sourceIntervalSeconds }),
    });
    const data = await response.json();
    if (!response.ok) return setStartError(data?.error ?? copy.marketReplay.invalidStart);
    const next = createReplayState(dataset.barCount, data.startSequence, data.playbackRate, data.displayIntervalSeconds, data.currentSequence);
    setStartError(null); setReplay(next);
    await loadWindow(next.currentSequence, next.displayIntervalSeconds, EMA_LENGTH_MAX);
  }

  function togglePlayback() {
    if (!replay) return;
    const next = replay.status === "playing" ? pauseReplay(replay) : playReplay(replay);
    setReplay(next);
    if (next.status !== "playing") queueSave(next, true);
  }

  const revealNextBar = useCallback(() => {
    const current = latestReplayRef.current;
    if (!current || current.status === "playing" || current.status === "finished") return;
    setReplay(pauseReplay(current));
    void advanceBars(1, false, current.displayIntervalSeconds);
  }, [advanceBars]);

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
    if (!replay) return;
    const next = setPlaybackRate(replay, value);
    setReplay(next);
    queueSave(next, true);
  }

  async function changeDisplayInterval(value: number) {
    if (!replay || !dataset.sourceIntervalSeconds || !isValidDisplayInterval(dataset.sourceIntervalSeconds, value)) {
      setEmaError(copy.marketReplay.invalidDisplayInterval); return;
    }
    const next = setDisplayInterval(replay, value);
    setReplay(next); setEmaError(null); queueSave(next, true);
    await loadWindow(next.currentSequence, value, EMA_LENGTH_MAX);
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
    if (!replay) return;
    if (action !== "paper-clear" && replay.status === "playing") {
      const paused = pauseReplay(replay);
      setReplay(paused);
      queueSave(paused, true);
    }
    setConfirmAction(action);
  }

  async function applyConfirmedAction() {
    if (!replay || !confirmAction) return;
    if (confirmAction === "paper-clear") {
      const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`, { method: "DELETE" });
      if (!response.ok) setPaperError(copy.paperTrading.requestFailed);
      else { commitPaperSnapshot(null); setPaperError(null); }
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
      if (!response.ok) {
        setSaveStatus("error");
        setConfirmAction(null);
        return;
      }
      commitPaperSnapshot(null);
      if (confirmAction === "reset") {
        const reset = resetReplay(replay);
        setReplay(reset);
        await loadWindow(reset.currentSequence, reset.displayIntervalSeconds, EMA_LENGTH_MAX);
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
      paperMutationActiveRef.current = true;
      await advanceCompletionRef.current.catch(() => undefined);
      try {
        const version = paperSnapshotRef.current?.session.version ?? null;
        const response = await fetch(url, createInit(version));
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 409) await reloadPaper();
          throw new Error(data?.error ?? copy.paperTrading.requestFailed);
        }
        if (data.snapshot !== undefined) commitPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
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
    if (saveStatus === "saving") return copy.marketReplay.saving;
    if (saveStatus === "error") return copy.marketReplay.saveError;
    return saveStatus === "saved" ? copy.marketReplay.saved : "";
  }, [saveStatus]);

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
              <p className="text-xs text-slate-500">{dataset.timezone} · {formatReplayTime(dataset.startTime, dataset.timezone)} – {formatReplayTime(dataset.endTime, dataset.timezone)}</p>
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
            timezone={dataset.timezone}
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
          <Button type="button" size="sm" className="h-9" onClick={togglePlayback} disabled={replay.status === "finished"}>
            {replay.status === "playing" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{replay.status === "playing" ? copy.marketReplay.pause : copy.marketReplay.play}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={revealNextBar} disabled={replay.status === "finished" || replay.status === "playing"}>
            <ChevronRight className="h-4 w-4" />{copy.marketReplay.nextBar}<kbd className="ml-1 hidden rounded border bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 lg:inline">{copy.marketReplay.nextBarShortcut}</kbd>
          </Button>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <Label htmlFor="replay-speed" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.speed}</Label>
          <Input id="replay-speed" type="range" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => changeSpeed(Number(event.target.value))} className="h-8 w-24 border-0 bg-transparent px-0 lg:w-32" />
          <Input aria-label={copy.marketReplay.speed} type="number" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => changeSpeed(Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Number(event.target.value))))} className="h-8 w-20" />
          <span className="text-xs font-medium text-slate-700">{copy.marketReplay.playbackRate(replay.playbackRate)}</span>
          <div className="ml-auto hidden items-center gap-4 text-xs xl:flex">
            <span className="text-slate-500">{copy.marketReplay.progress(revealedCount, replayCount)}</span>
            <span className="font-medium text-slate-800">{currentBar ? formatReplayTime(currentBar.timestamp, dataset.timezone) : copy.marketReplay.waiting}</span>
            <span className="hidden font-mono text-slate-600 2xl:inline">{currentBar ? `${currentBar.open} / ${currentBar.high} / ${currentBar.low} / ${currentBar.close}` : "–"}</span>
            <span className="font-medium text-slate-700">{replay.status === "playing" ? copy.marketReplay.play : replay.status === "finished" ? copy.marketReplay.finished : copy.marketReplay.pause}{statusText ? ` · ${statusText}` : ""}</span>
          </div>
        </div>
        <PaperTradingDetails snapshot={paperSnapshot} />
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
