"use client";

import { ChevronRight, Pause, Play } from "lucide-react";
import { PaperTradingDetails } from "./paper-trading-panel";
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
  journalReview: boolean;
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
};

export function ReplayPlaybackBar({
  replay, sourceIntervalSeconds, journalReview, paperSnapshot, currentBar,
  displayUtcOffsetMinutes, revealedCount, replayCount, statusText,
  onToggle, onNext, onSpeedChange, onFocusJournalEntry,
}: Props) {
  const stateLabel = replay.status === "playing"
    ? copy.marketReplay.play
    : replay.status === "finished" ? copy.marketReplay.finished : copy.marketReplay.pause;
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-t bg-slate-50/80 px-3">
      <Button type="button" size="sm" className="h-9" title={copy.marketReplay.playbackTiming(sourceIntervalSeconds / replay.playbackRate)} onClick={onToggle} disabled={replay.status === "finished" || journalReview}>
        {replay.status === "playing" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{replay.status === "playing" ? copy.marketReplay.pause : copy.marketReplay.play}
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-9" onClick={onNext} disabled={replay.status === "finished" || replay.status === "playing" || journalReview}>
        <ChevronRight className="h-4 w-4" />{copy.marketReplay.nextBar}<kbd className="ml-1 hidden rounded border bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 lg:inline">{copy.marketReplay.nextBarShortcut}</kbd>
      </Button>
      <PaperTradingDetails snapshot={paperSnapshot} onFocusJournalEntry={onFocusJournalEntry} />
      <div className="mx-1 h-6 w-px bg-slate-200" />
      <Label htmlFor="replay-speed" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.speed}</Label>
      <Input id="replay-speed" type="range" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => onSpeedChange(Number(event.target.value))} className="h-8 w-24 border-0 bg-transparent px-0 lg:w-32" />
      <Input aria-label={copy.marketReplay.speed} type="number" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={replay.playbackRate} onChange={(event) => onSpeedChange(Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Number(event.target.value))))} className="h-8 w-20" />
      <span className="text-xs font-medium text-slate-700">{copy.marketReplay.playbackRate(replay.playbackRate)}</span>
      <span className="ml-auto max-w-48 truncate text-xs font-medium text-slate-700 xl:hidden" title={statusText || undefined}>
        {stateLabel}{statusText ? ` · ${statusText}` : ""}
      </span>
      <div className="ml-auto hidden items-center gap-4 text-xs xl:flex">
        <span className="text-slate-500">{copy.marketReplay.progress(revealedCount, replayCount)}</span>
        <span className="font-medium text-slate-800">{currentBar ? formatUtcDateTime(currentBar.timestamp, displayUtcOffsetMinutes) : copy.marketReplay.waiting}</span>
        <span className="hidden font-mono text-slate-600 2xl:inline">{currentBar ? `${currentBar.open} / ${currentBar.high} / ${currentBar.low} / ${currentBar.close}` : "–"}</span>
        <span className="font-medium text-slate-700">{stateLabel}{statusText ? ` · ${statusText}` : ""}</span>
      </div>
    </div>
  );
}

