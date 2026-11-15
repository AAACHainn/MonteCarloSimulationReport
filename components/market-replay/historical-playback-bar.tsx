"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { copy } from "@/lib/i18n";
import type { HistoricalPlaybackState } from "@/lib/market-replay/historical-playback";
import { ReplayTransportButtons, ReplaySpeedControls } from "./replay-transport-controls";

export function HistoricalPlaybackBar({ playback, seconds, disabled = false, onToggle, onNext, onRate, onExit }: {
  playback: HistoricalPlaybackState; seconds: number; disabled?: boolean;
  onToggle: () => void; onNext: () => void; onRate: (rate: number) => void; onExit: () => void;
}) {
  if (!playback.active) return null;
  return <div data-historical-playback-controls className="flex h-14 shrink-0 items-center gap-2 border-t bg-slate-50/80 dark:bg-muted/80 px-3" aria-busy={playback.busy}>
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [&>*]:shrink-0" aria-label={copy.marketReplay.historicalPlayback}>
      <ReplayTransportButtons playing={playback.playing} secondsPerBar={seconds} rate={playback.rate}
        playDisabled={playback.finished || disabled} stepDisabled={playback.finished || playback.busy || playback.playing || disabled}
        timing={copy.marketReplay.historicalPlaybackTiming(formatNumber(seconds / playback.rate))}
        onToggle={onToggle} onNext={onNext} />
      <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-hover" />
      <ReplaySpeedControls rate={playback.rate} onChange={onRate} />
      <span role={playback.error ? "alert" : "status"} aria-live="polite"
        className={playback.error ? "text-xs text-negative" : "text-xs text-secondary-text"} title={copy.marketReplay.historicalPlaybackHint}>
        {playback.error ?? (playback.finished ? copy.marketReplay.historicalPlaybackFinished : playback.playing ? copy.marketReplay.play : copy.marketReplay.pause)}
      </span>
    </div>
    <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={onExit}>
      <X className="h-4 w-4" aria-hidden="true" />{copy.marketReplay.exitHistoricalPlayback}
    </Button>
  </div>;
}
