"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronRight, Pause, Play } from "lucide-react";
import { PaperTradingDetails } from "./paper-trading-panel";
import { useReplayShortcuts } from "./use-replay-shortcuts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { formatUtcDateTime } from "@/lib/market-replay/display-timezone";
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, type MarketBarData, type ReplayState } from "@/lib/market-replay/types";
import type { PaperSessionSnapshot, ReplayJournalEntryData } from "@/lib/paper-trading/types";

type Props = {
  replay: ReplayState;
  sourceIntervalSeconds: number;
  paperSnapshot: PaperSessionSnapshot | null;
  currentBar: MarketBarData | null;
  displayUtcOffsetMinutes: number;
  revealedCount: number;
  replayCount: number;
  statusText: string;
  onToggle: () => void;
  onNext: () => void;
  onSpeedChange: (value: number) => void;
  onFocusJournalEntry: (entry: ReplayJournalEntryData) => void;
  retrying?: boolean;
  playbackRequested?: boolean;
  correctionPending?: boolean;
  onLocateDate?: () => void;
  dateForwarding?: boolean;
  dateForwardStatus?: string;
  onStopDateForward?: () => void;
};

export function ReplayPlaybackBar({
  replay, sourceIntervalSeconds, paperSnapshot, currentBar,
  displayUtcOffsetMinutes, revealedCount, replayCount, statusText,
  onToggle, onNext, onSpeedChange, onFocusJournalEntry, correctionPending = false, retrying = false, playbackRequested = replay.status === "playing",
  onLocateDate, dateForwarding = false, dateForwardStatus, onStopDateForward,
}: Props) {
  const shortcuts = useReplayShortcuts();
  const stateLabel = replay.status === "finished" ? copy.marketReplay.finished
    : playbackRequested ? copy.marketReplay.play : copy.marketReplay.pause;
  const statusLabel = stateLabel + (statusText ? ` · ${statusText}` : "");
  const statusDot = <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${replay.status === "finished" ? "bg-slate-400" : playbackRequested ? "bg-emerald-500" : "bg-amber-500"}`} />;
  const status = (
    <span role="status" aria-live="polite" aria-atomic="true" className={`inline-flex h-8 shrink-0 items-center justify-end gap-2 whitespace-nowrap text-xs font-medium text-slate-700 ${statusText ? "w-48" : ""}`}>
      {statusText ? <Popover.Root>
        <Popover.Trigger asChild><Button type="button" variant="ghost" className="h-8 w-full min-w-0 justify-end px-0 text-xs" aria-label={statusLabel}>{statusDot}<span className="truncate">{statusLabel}</span></Button></Popover.Trigger>
        <Popover.Portal><Popover.Content side="top" align="end" collisionPadding={8} aria-label={copy.marketReplay.status} className="z-[70] max-w-[calc(100vw-2rem)] rounded-md border bg-white px-3 py-2 text-sm text-slate-700 shadow-lg"><p className="mb-1 font-medium">{copy.marketReplay.status}</p><p className="max-w-xs">{statusText}</p></Popover.Content></Popover.Portal>
      </Popover.Root> : <>{statusDot}{stateLabel}</>}
    </span>
  );
  return (
    <div aria-busy={retrying} className="flex h-14 shrink-0 items-center gap-2 border-t bg-slate-50/80 px-3 pr-20">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [&>*]:shrink-0">
        <Button
          type="button"
          size="sm"
          className="h-9"
          title={`${copy.marketReplay.playbackTiming(sourceIntervalSeconds / replay.playbackRate)}\n${copy.marketReplay.playbackShortcutHint(shortcuts.playback)}`}
          aria-keyshortcuts={shortcuts.playbackAria}
          onClick={onToggle}
          disabled={replay.status === "finished" || correctionPending}
        >
          {playbackRequested ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playbackRequested ? copy.marketReplay.pause : copy.marketReplay.play}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9" title={copy.marketReplay.playbackShortcutHint(shortcuts.nextBar)} aria-keyshortcuts={shortcuts.nextBarAria} onClick={onNext} disabled={retrying || replay.status === "finished" || replay.status === "playing" || correctionPending}>
          <ChevronRight className="h-4 w-4" />{copy.marketReplay.nextBar}
        </Button>
        {onLocateDate ? <Button type="button" variant="outline" size="sm" className="h-9" disabled={correctionPending || dateForwarding} onClick={onLocateDate}><CalendarDays className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.locateDate}</Button> : null}
        {dateForwarding ? <><span role="status" className="max-w-64 truncate text-xs tabular-nums text-slate-600" title={dateForwardStatus}>{dateForwardStatus}</span><Button type="button" size="sm" variant="outline" className="h-9" onClick={onStopDateForward}>{copy.replaySessions.forwardCancel}</Button></> : null}
        <PaperTradingDetails snapshot={paperSnapshot} onFocusJournalEntry={onFocusJournalEntry} />
        <div className="mx-1 h-6 w-px bg-slate-200" />
        <Label htmlFor="replay-speed" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.speed}</Label>
        <Input id="replay-speed" type="range" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => onSpeedChange(Number(event.target.value))} className="h-8 w-24 border-0 bg-transparent px-0 lg:w-32" />
        <Input aria-label={copy.marketReplay.speed} type="number" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => onSpeedChange(Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Number(event.target.value))))} className="h-8 w-20" />
        <span className="text-xs font-medium text-slate-700">{copy.marketReplay.playbackRate(replay.playbackRate)}</span>
        <div className="ml-auto hidden items-center gap-4 text-xs xl:flex">
          <span className="text-slate-500">{copy.marketReplay.progress(revealedCount, replayCount)}</span>
          <span className="font-medium text-slate-800">{currentBar ? formatUtcDateTime(currentBar.timestamp, displayUtcOffsetMinutes) : copy.marketReplay.waiting}</span>
          <span className="hidden font-mono text-slate-600 2xl:inline">{currentBar ? `${currentBar.open} / ${currentBar.high} / ${currentBar.low} / ${currentBar.close}` : "–"}</span>
        </div>
      </div>
      {status}
    </div>
  );
}
