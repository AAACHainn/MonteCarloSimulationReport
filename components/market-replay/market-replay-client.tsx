"use client";

import { TZDate } from "@date-fns/tz";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2, Pause, Play, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { ReplayChart } from "@/components/market-replay/replay-chart";
import { PaperAccountStrip, PaperTradingDetails, PaperTradingPanel } from "@/components/market-replay/paper-trading-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import {
  createReplayState,
  findReplayStartSequence,
  pauseReplay,
  playReplay,
  resetReplay,
  setReplayInterval,
} from "@/lib/market-replay/engine";
import {
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  MAX_EMA_INDICATORS,
  REPLAY_INTERVALS,
  type EmaIndicatorConfig,
  type MarketBarData,
  type MarketDatasetSummary,
  type ReplayIntervalMs,
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
  const [bars, setBars] = useState<MarketBarData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [startValue, setStartValue] = useState(() => dateTimeLocalValue(dataset.startTime, dataset.timezone));
  const [startError, setStartError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [confirmAction, setConfirmAction] = useState<"reset" | "change-start" | "paper-clear" | null>(null);
  const [emaEnabled, setEmaEnabled] = useState(false);
  const [emaIndicators, setEmaIndicators] = useState<EmaIndicatorConfig[]>(DEFAULT_EMA_INDICATORS);
  const [emaSettingsLoaded, setEmaSettingsLoaded] = useState(false);
  const [emaError, setEmaError] = useState<string | null>(null);
  const [paperSnapshot, setPaperSnapshot] = useState<PaperSessionSnapshot | null>(null);
  const [paperBusy, setPaperBusy] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const latestReplayRef = useRef<ReplayState | null>(null);
  const pendingSaveRef = useRef<ReplayState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveAtRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const paperSnapshotRef = useRef<PaperSessionSnapshot | null>(null);
  const advancingRef = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-datasets/${dataset.id}/bars`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? copy.marketReplay.loadError);
        return data.bars as MarketBarData[];
      })
      .then((loadedBars) => {
        if (cancelled) return;
        setBars(loadedBars);
        if (dataset.progress) {
          setReplay(createReplayState(
            loadedBars.length,
            dataset.progress.startSequence,
            dataset.progress.intervalMs,
            dataset.progress.currentSequence,
          ));
        }
      })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : copy.marketReplay.loadError); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [dataset.id, dataset.progress]);

  useEffect(() => { latestReplayRef.current = replay; }, [replay]);
  useEffect(() => { paperSnapshotRef.current = paperSnapshot; }, [paperSnapshot]);

  const reloadPaper = useCallback(async () => {
    const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.requestFailed);
    setPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
    return data.snapshot as PaperSessionSnapshot | null;
  }, [dataset.id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-datasets/${dataset.id}/paper-session`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.requestFailed);
        if (!cancelled) setPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
      })
      .catch((error) => { if (!cancelled) setPaperError(error instanceof Error ? error.message : copy.paperTrading.requestFailed); });
    return () => { cancelled = true; };
  }, [dataset.id]);

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
          intervalMs: next.intervalMs,
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

  const advanceOneBar = useCallback(async (keepPlaying: boolean) => {
    const current = latestReplayRef.current;
    if (!current || advancingRef.current || current.currentSequence >= current.barCount - 1) return;
    advancingRef.current = true;
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/replay/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedCurrentSequence: current.currentSequence,
          expectedVersion: paperSnapshotRef.current?.session.version ?? null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) await reloadPaper();
        throw new Error(data?.error ?? copy.paperTrading.advanceFailed);
      }
      if (data.snapshot) setPaperSnapshot(data.snapshot as PaperSessionSnapshot);
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
    }
  }, [dataset.id, reloadPaper]);

  useEffect(() => {
    if (!replay || replay.status !== "playing") return;
    const timer = setTimeout(() => { void advanceOneBar(true); }, replay.intervalMs);
    return () => clearTimeout(timer);
  }, [advanceOneBar, replay]);

  useEffect(() => {
    const persistLatest = () => {
      const current = latestReplayRef.current;
      if (!current) return;
      void fetch(`/api/market-datasets/${dataset.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startSequence: current.startSequence, currentSequence: current.currentSequence, intervalMs: current.intervalMs }),
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

  function beginReplay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startSequence = findReplayStartSequence(bars, selectedTimeToTimestamp(startValue, dataset.timezone));
    if (startSequence < 0) {
      setStartError(copy.marketReplay.invalidStart);
      return;
    }
    const next = createReplayState(bars.length, startSequence, 1_000);
    setStartError(null);
    setReplay(next);
    queueSave(next, true);
  }

  function togglePlayback() {
    if (!replay) return;
    const next = replay.status === "playing" ? pauseReplay(replay) : playReplay(replay);
    setReplay(next);
    if (next.status !== "playing") queueSave(next, true);
  }

  function revealNextBar() {
    if (!replay) return;
    setReplay(pauseReplay(replay));
    void advanceOneBar(false);
  }

  function changeSpeed(value: number) {
    if (!replay) return;
    const next = setReplayInterval(replay, value as ReplayIntervalMs);
    setReplay(next);
    queueSave(next, true);
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
    if (replay.status === "playing") {
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
      else { setPaperSnapshot(null); setPaperError(null); }
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
      setPaperSnapshot(null);
      setReplay(confirmAction === "reset" ? resetReplay(replay) : null);
      setSaveStatus("idle");
    }
    setConfirmAction(null);
  }

  function pauseForTrading() {
    const current = latestReplayRef.current;
    if (!current || current.status !== "playing") return;
    const paused = pauseReplay(current);
    setReplay(paused);
    queueSave(paused, true);
  }

  async function mutatePaper(url: string, init: RequestInit) {
    pauseForTrading();
    setPaperBusy(true);
    setPaperError(null);
    try {
      const response = await fetch(url, init);
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) await reloadPaper();
        throw new Error(data?.error ?? copy.paperTrading.requestFailed);
      }
      if (data.snapshot !== undefined) setPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
    } catch (error) {
      setPaperError(error instanceof Error ? error.message : copy.paperTrading.requestFailed);
      if (paperSnapshotRef.current) await reloadPaper().catch(() => undefined);
    } finally {
      setPaperBusy(false);
    }
  }

  async function createPaperAccount(config: { initialCapital: number; currency: string; commissionBps: number; slippageBps: number }) {
    await mutatePaper(`/api/market-datasets/${dataset.id}/paper-session`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
    });
  }

  async function submitPaperOrder(order: { side: PaperSide; type: PaperOrderType; quantity: number; price: number | null; stopLoss: number | null; takeProfit: number | null; reduceOnly?: boolean }) {
    const version = paperSnapshotRef.current?.session.version;
    if (!version) return;
    await mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...order, expectedVersion: version }),
    });
  }

  async function updatePaperOrder(orderId: string, update: { price?: number; quantity?: number }) {
    const version = paperSnapshotRef.current?.session.version;
    if (!version) return;
    await mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders/${orderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...update, expectedVersion: version }),
    });
  }

  async function cancelPaperOrder(orderId: string) {
    const version = paperSnapshotRef.current?.session.version;
    if (!version) return;
    await mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders/${orderId}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version }),
    });
  }

  async function cancelPaperScope(scope: "ALL" | "BRACKET") {
    const version = paperSnapshotRef.current?.session.version;
    if (!version) return;
    await mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, scope }),
    });
  }

  const currentBar = replay && replay.currentSequence >= 0 ? bars[replay.currentSequence] : null;
  const revealedCount = replay ? Math.max(0, replay.currentSequence - replay.startSequence + 1) : 0;
  const replayCount = replay ? replay.barCount - replay.startSequence : 0;
  const statusText = useMemo(() => {
    if (saveStatus === "saving") return copy.marketReplay.saving;
    if (saveStatus === "error") return copy.marketReplay.saveError;
    return saveStatus === "saved" ? copy.marketReplay.saved : "";
  }, [saveStatus]);

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
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={togglePlayback} disabled={replay.status === "finished"}>
                {replay.status === "playing" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {replay.status === "playing" ? copy.marketReplay.pause : copy.marketReplay.play}
              </Button>
              <Button type="button" variant="outline" onClick={revealNextBar} disabled={replay.status === "finished" || replay.status === "playing"}>
                <ChevronRight className="h-4 w-4" />{copy.marketReplay.nextBar}
              </Button>
              <div className="flex items-center gap-2">
                <Label htmlFor="replay-speed" className="whitespace-nowrap">{copy.marketReplay.speed}</Label>
                <select id="replay-speed" value={replay.intervalMs} onChange={(event) => changeSpeed(Number(event.target.value))} className="h-10 rounded-md border bg-white px-3 text-sm">
                  {REPLAY_INTERVALS.map((interval) => <option key={interval} value={interval}>{copy.marketReplay.speedLabels[interval]}</option>)}
                </select>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => requestConfirmation("reset")}><RotateCcw className="h-4 w-4" />{copy.marketReplay.reset}</Button>
                <Button type="button" variant="outline" onClick={() => requestConfirmation("change-start")}>{copy.marketReplay.chooseNewStart}</Button>
              </div>
            </div>
            <div className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-slate-500">{copy.marketReplay.recentProgress}</p><p className="font-medium text-slate-950">{copy.marketReplay.progress(revealedCount, replayCount)}</p></div>
              <div><p className="text-xs text-slate-500">{copy.marketReplay.currentTime}</p><p className="font-medium text-slate-950">{currentBar ? formatReplayTime(currentBar.timestamp, dataset.timezone) : copy.marketReplay.waiting}</p></div>
              <div><p className="text-xs text-slate-500">{copy.marketReplay.ohlc}</p><p className="font-mono text-xs text-slate-800">{currentBar ? `${currentBar.open} / ${currentBar.high} / ${currentBar.low} / ${currentBar.close}` : "–"}</p></div>
              <div><p className="text-xs text-slate-500">{copy.marketReplay.status}</p><p className="font-medium text-slate-950">{replay.status === "playing" ? copy.marketReplay.play : replay.status === "finished" ? copy.marketReplay.finished : copy.marketReplay.pause}{statusText ? ` · ${statusText}` : ""}</p></div>
            </div>
            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-950">{copy.marketReplay.emaTitle}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{copy.marketReplay.emaDescription}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{emaEnabled ? copy.marketReplay.emaOn : copy.marketReplay.emaOff}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={emaEnabled}
                    aria-label={copy.marketReplay.emaMaster}
                    onClick={() => setEmaEnabled((enabled) => !enabled)}
                    className={`relative h-6 w-11 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${emaEnabled ? "bg-blue-600" : "bg-slate-300"}`}
                  >
                    <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${emaEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {emaIndicators.map((indicator) => (
                  <div key={indicator.id} className="flex h-10 items-center gap-2 rounded-md border bg-slate-50 px-2">
                    <input
                      type="checkbox"
                      checked={indicator.visible}
                      onChange={(event) => setEmaIndicators((current) => current.map((item) => item.id === indicator.id ? { ...item, visible: event.target.checked } : item))}
                      aria-label={copy.marketReplay.emaLineToggle(indicator.length)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: indicator.color }} aria-hidden="true" />
                    <span className="whitespace-nowrap text-xs font-medium text-slate-700">{copy.marketReplay.emaShortName}</span>
                    <Label htmlFor={`ema-length-${indicator.id}`} className="sr-only">{copy.marketReplay.emaLength}</Label>
                    <Input
                      key={`${indicator.id}-${indicator.length}`}
                      id={`ema-length-${indicator.id}`}
                      type="number"
                      min={EMA_LENGTH_MIN}
                      max={EMA_LENGTH_MAX}
                      step="1"
                      defaultValue={indicator.length}
                      onBlur={(event) => {
                        if (!setEmaLength(indicator.id, Number(event.currentTarget.value))) {
                          event.currentTarget.value = String(indicator.length);
                        }
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                      className="h-8 w-20 bg-white font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEmaIndicators((current) => current.filter((item) => item.id !== indicator.id));
                        setEmaError(null);
                      }}
                      aria-label={copy.marketReplay.emaRemove(indicator.length)}
                      className="h-7 w-7 text-slate-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addEma} disabled={emaIndicators.length >= MAX_EMA_INDICATORS}>
                  <Plus className="h-4 w-4" />{copy.marketReplay.emaAdd}
                </Button>
              </div>
              {emaError ? <p className="text-xs text-red-600">{emaError}</p> : null}
            </div>
          </CardContent>
        </Card>
        <PaperAccountStrip snapshot={paperSnapshot} />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <ReplayChart
            bars={bars}
            startSequence={replay.startSequence}
            currentSequence={replay.currentSequence}
            timezone={dataset.timezone}
            emaEnabled={emaEnabled}
            emaIndicators={emaIndicators}
            paperSnapshot={paperSnapshot}
            onOrderPriceChange={updatePaperOrder}
            onTradingInteraction={pauseForTrading}
          />
          <PaperTradingPanel
            snapshot={paperSnapshot}
            currentBar={currentBar}
            busy={paperBusy}
            error={paperError}
            onCreate={createPaperAccount}
            onSubmit={submitPaperOrder}
            onCancel={cancelPaperOrder}
            onUpdate={updatePaperOrder}
            onCancelScope={cancelPaperScope}
            onClear={() => requestConfirmation("paper-clear")}
          />
        </div>
        <PaperTradingDetails snapshot={paperSnapshot} />
      </div>
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
