"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronRight, Maximize, Minimize, Pause, Play } from "lucide-react";
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
  webFullscreen: boolean;
  onToggleWebFullscreen: () => void;
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
  webFullscreen, onToggleWebFullscreen,
  onToggle, onNext, onSpeedChange, onFocusJournalEntry, correctionPending = false, retrying = false, playbackRequested = replay.status === "playing",
  onLocateDate, dateForwarding = false, dateForwardStatus, onStopDateForward,
}: Props) {
  const shortcuts = useReplayShortcuts();
  const stateLabel = replay.status === "finished" ? copy.marketReplay.finished
    : playbackRequested ? copy.marketReplay.play : copy.marketReplay.pause;
  const statusLabel = stateLabel + (statusText ? ` · ${statusText}` : "");
  const status = (
    <span role="status" aria-live="polite" aria-atomic="true" className="inline-flex h-8 w-48 shrink-0 items-center justify-end text-xs font-medium text-slate-700">
      {statusText ? <Popover.Root>
        <Popover.Trigger asChild><Button type="button" variant="ghost" className="h-8 w-full min-w-0 justify-end px-0 text-xs" aria-label={statusLabel}><span className="truncate">{statusLabel}</span></Button></Popover.Trigger>
        <Popover.Portal><Popover.Content side="top" align="end" collisionPadding={8} aria-label={copy.marketReplay.status} className="z-[70] max-w-[calc(100vw-2rem)] rounded-md border bg-white px-3 py-2 text-sm text-slate-700 shadow-lg"><p className="mb-1 font-medium">{copy.marketReplay.status}</p><p className="max-w-xs">{statusText}</p></Popover.Content></Popover.Portal>
      </Popover.Root> : stateLabel}
    </span>
  );
  return (
    <div aria-busy={retrying} className="flex h-14 shrink-0 items-center gap-2 border-t bg-slate-50/80 px-3">
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
          <ChevronRight className="h-4 w-4" />{copy.marketReplay.nextBar}<kbd className="ml-1 hidden rounded border bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 lg:inline">{shortcuts.nextBar}</kbd>
        </Button>
        {onLocateDate ? <Button type="button" variant="outline" size="sm" className="h-9" disabled={correctionPending || dateForwarding} onClick={onLocateDate}><CalendarDays className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.locateDate}</Button> : null}
        {dateForwarding ? <><span role="status" className="max-w-64 truncate text-xs tabular-nums text-slate-600" title={dateForwardStatus}>{dateForwardStatus}</span><Button type="button" size="sm" variant="outline" className="h-9" onClick={onStopDateForward}>{copy.replaySessions.forwardCancel}</Button></> : null}
        <PaperTradingDetails snapshot={paperSnapshot} onFocusJournalEntry={onFocusJournalEntry} />
        <div className="mx-1 h-6 w-px bg-slate-200" />
        <Label htmlFor="replay-speed" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.speed}</Label>
        <Input id="replay-speed" type="range" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => onSpeedChange(Number(event.target.value))} className="h-8 w-24 border-0 bg-transparent px-0 lg:w-32" />
        <Input aria-label={copy.marketReplay.speed} type="number" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => onSpeedChange(Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Number(event.target.value))))} className="h-8 w-20" />
        <span className="text-xs font-medium text-slate-700">{copy.marketReplay.playbackRate(replay.playbackRate)}</span>
        <span className="ml-auto xl:hidden">{status}</span>
        <div className="ml-auto hidden items-center gap-4 text-xs xl:flex">
          <span className="text-slate-500">{copy.marketReplay.progress(revealedCount, replayCount)}</span>
          <span className="font-medium text-slate-800">{currentBar ? formatUtcDateTime(currentBar.timestamp, displayUtcOffsetMinutes) : copy.marketReplay.waiting}</span>
          <span className="hidden font-mono text-slate-600 2xl:inline">{currentBar ? `${currentBar.open} / ${currentBar.high} / ${currentBar.low} / ${currentBar.close}` : "–"}</span>
          {status}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 sm:h-9 sm:w-9"
        aria-label={webFullscreen ? copy.marketReplay.exitWebFullscreen : copy.marketReplay.enterWebFullscreen}
        aria-pressed={webFullscreen}
        title={webFullscreen ? copy.marketReplay.webFullscreenExitHint : copy.marketReplay.enterWebFullscreen}
        onClick={onToggleWebFullscreen}
      >
        {webFullscreen ? <Minimize className="h-4 w-4" aria-hidden="true" /> : <Maximize className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </div>
  );
}
