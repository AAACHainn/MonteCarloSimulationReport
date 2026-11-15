"use client";

import { useId } from "react";
import { ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE } from "@/lib/market-replay/types";
import { useReplayShortcuts } from "./use-replay-shortcuts";

export function ReplayTransportButtons({ playing, playDisabled, stepDisabled, secondsPerBar, rate, onToggle, onNext, timing }: {
  playing: boolean; playDisabled: boolean; stepDisabled: boolean; secondsPerBar: number; rate: number;
  onToggle: () => void; onNext: () => void; timing?: string;
}) {
  const shortcuts = useReplayShortcuts();
  return <>
    <Button type="button" size="sm" className="h-9" onClick={onToggle} disabled={playDisabled}
      title={`${timing ?? copy.marketReplay.playbackTiming(secondsPerBar / rate)}\n${copy.marketReplay.playbackShortcutHint(shortcuts.playback)}`}
      aria-keyshortcuts={shortcuts.playbackAria}>
      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? copy.marketReplay.pause : copy.marketReplay.play}
    </Button>
    <Button type="button" size="sm" variant="outline" className="h-9" onClick={onNext} disabled={stepDisabled}
      title={copy.marketReplay.playbackShortcutHint(shortcuts.nextBar)} aria-keyshortcuts={shortcuts.nextBarAria}>
      <ChevronRight className="h-4 w-4" />{copy.marketReplay.nextBar}
    </Button>
  </>;
}

export function ReplaySpeedControls({ rate, onChange }: { rate: number; onChange: (value: number) => void }) {
  const id = useId();
  return <>
    <Label htmlFor={id} className="whitespace-nowrap text-xs text-slate-500 dark:text-muted-foreground">{copy.marketReplay.speed}</Label>
    <Input id={id} type="range" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={rate}
      onChange={event => onChange(Number(event.target.value))} className="h-8 w-24 border-0 bg-transparent px-0 lg:w-32" />
    <Input aria-label={copy.marketReplay.speed} type="number" min={MIN_PLAYBACK_RATE} max={MAX_PLAYBACK_RATE} value={rate}
      onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) onChange(Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Math.round(value)))); }} className="h-8 w-20" />
    <span className="text-xs font-medium text-slate-700 dark:text-secondary-text">{copy.marketReplay.playbackRate(rate)}</span>
  </>;
}
