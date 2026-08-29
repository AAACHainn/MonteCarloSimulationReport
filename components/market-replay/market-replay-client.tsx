"use client";

import { TZDate } from "@date-fns/tz";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2, Pause, Play, RotateCcw, Settings2 } from "lucide-react";
import { ReplayChart } from "@/components/market-replay/replay-chart";
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
  stepReplay,
} from "@/lib/market-replay/engine";
import {
  REPLAY_INTERVALS,
  type MarketBarData,
  type MarketDatasetSummary,
  type ReplayIntervalMs,
  type ReplayState,
} from "@/lib/market-replay/types";

type SaveStatus = "idle" | "saving" | "saved" | "error";

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
  const [confirmAction, setConfirmAction] = useState<"reset" | "change-start" | null>(null);
  const latestReplayRef = useRef<ReplayState | null>(null);
  const pendingSaveRef = useRef<ReplayState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveAtRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

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

  useEffect(() => {
    if (!replay || replay.status !== "playing") return;
    const timer = setTimeout(() => setReplay((current) => current ? stepReplay(current) : current), replay.intervalMs);
    return () => clearTimeout(timer);
  }, [replay]);

  useEffect(() => {
    if (!replay) return;
    if (replay.status === "playing") queueSave(replay, false);
    if (replay.status === "finished") queueSave(replay, true);
  }, [queueSave, replay]);

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
    const next = stepReplay(pauseReplay(replay));
    setReplay(next);
    queueSave(next, true);
  }

  function changeSpeed(value: number) {
    if (!replay) return;
    const next = setReplayInterval(replay, value as ReplayIntervalMs);
    setReplay(next);
    queueSave(next, true);
  }

  function requestConfirmation(action: "reset" | "change-start") {
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
    if (confirmAction === "reset") {
      const next = resetReplay(replay);
      setReplay(next);
      queueSave(next, true);
    } else {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      await saveChainRef.current.catch(() => undefined);
      const response = await fetch(`/api/market-datasets/${dataset.id}/progress`, { method: "DELETE" });
      if (!response.ok) {
        setSaveStatus("error");
        setConfirmAction(null);
        return;
      }
      setReplay(null);
      setSaveStatus("idle");
    }
    setConfirmAction(null);
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
          </CardContent>
        </Card>
        <ReplayChart bars={bars} startSequence={replay.startSequence} currentSequence={replay.currentSequence} timezone={dataset.timezone} />
      </div>
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction === "reset" ? copy.marketReplay.resetTitle : copy.marketReplay.changeStartTitle}
        description={confirmAction === "reset" ? copy.marketReplay.resetConfirm : copy.marketReplay.changeStartConfirm}
        onCancel={() => setConfirmAction(null)}
        onConfirm={applyConfirmedAction}
      />
    </>
  );
}
