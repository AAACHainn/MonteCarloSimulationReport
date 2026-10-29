"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/i18n";
import {
  CANDLESTICK_COLOR_PRESETS,
  DEFAULT_CANDLESTICK_STYLE,
  applyCandlestickColorPreset,
  matchingCandlestickColorPreset,
  type CandlestickStyle,
} from "@/lib/market-replay/candlestick-style";

function CandlePair({ style, className }: { style: CandlestickStyle; className: string }) {
  return (
    <svg viewBox="0 0 100 52" className={className} aria-hidden="true">
      {(["up", "down"] as const).map((side, index) => {
        const x = index === 0 ? 22 : 78;
        const fill = side === "up" ? style.upColor : style.downColor;
        const border = side === "up" ? style.borderUpColor : style.borderDownColor;
        const wick = side === "up" ? style.wickUpColor : style.wickDownColor;
        return (
          <g key={side}>
            {style.wickVisible ? <path d={`M ${x} 5 V 12 M ${x} 32 V 45`} stroke={wick} strokeWidth="1.25" /> : null}
            <rect x={x - 7} y="12" width="14" height="20" fill={style.bodyVisible ? fill : "none"} stroke={style.borderVisible ? border : "none"} strokeWidth="1.25" />
          </g>
        );
      })}
    </svg>
  );
}

type CandlestickSettingsDialogProps = {
  open: boolean;
  draft: CandlestickStyle | null;
  onDraftChange: (style: CandlestickStyle) => void;
  onClose: () => void;
  onConfirm: (style: CandlestickStyle) => void;
};

export function CandlestickSettingsDialog({ open, draft, onDraftChange, onClose, onConfirm }: CandlestickSettingsDialogProps) {
  const id = useId();
  const selectedPreset = draft ? matchingCandlestickColorPreset(draft) : undefined;
  return (
    <Dialog open={open} title={copy.marketReplay.candlestickSettings}
      description={copy.marketReplay.candlestickSettingsDescription}
      className="max-w-xl" contentClassName="flex flex-col p-0" onClose={onClose}>
      {draft ? <>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section aria-labelledby={`${id}-presets`} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`${id}-presets`} className="text-sm font-semibold text-slate-950">{copy.marketReplay.candlestickPresets}</h3>
              <p className="text-xs text-slate-500">{copy.marketReplay.candlestickPresetsHint}</p>
            </div>
            <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby={`${id}-presets`}>
              {CANDLESTICK_COLOR_PRESETS.map(preset => {
                const selected = selectedPreset?.id === preset.id;
                return <Button key={preset.id} type="button" variant="outline" aria-pressed={selected}
                  onClick={() => onDraftChange(applyCandlestickColorPreset(draft, preset))}
                  className={`relative h-auto flex-col gap-1 px-2 py-3 text-xs ${selected ? "border-primary bg-blue-50 text-blue-700 ring-1 ring-primary hover:bg-blue-50 hover:text-blue-700" : "text-slate-700"}`}>
                  {selected ? <Check className="absolute right-1.5 top-1.5 h-4 w-4" aria-hidden="true" /> : null}
                  <CandlePair style={{ ...DEFAULT_CANDLESTICK_STYLE, ...preset.colors }} className="h-9 w-14" />
                  {copy.marketReplay.candlestickPresetNames[preset.id]}
                </Button>;
              })}
            </div>
            <p className="text-xs text-slate-500">{copy.marketReplay.candlestickPresetsDescription}</p>
          </section>

          <section aria-labelledby={`${id}-custom`} className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`${id}-custom`} className="text-sm font-semibold text-slate-950">{copy.marketReplay.candlestickCustomStyle}</h3>
              <p className="text-xs text-slate-500" role="status" aria-live="polite">
                {copy.marketReplay.candlestickCurrentStyle(selectedPreset ? copy.marketReplay.candlestickPresetNames[selectedPreset.id] : copy.marketReplay.candlestickCustomColors)}
              </p>
            </div>
            <div className="flex items-center rounded-md border bg-slate-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-700">{copy.marketReplay.candlestickPreview}</p>
                <p className="mt-1 text-xs text-slate-600">{copy.marketReplay.candlestickPreviewSides}</p>
              </div>
              <div className="w-56 shrink-0 px-5"><CandlePair style={draft} className="h-14 w-full" /></div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] gap-2 px-3 text-center text-xs text-slate-500">
              <span /><span>{copy.marketReplay.bullishCandle}</span><span>{copy.marketReplay.bearishCandle}</span>
            </div>
            <div className="space-y-2">
              {([
                { visible: "bodyVisible", up: "upColor", down: "downColor", label: copy.marketReplay.candleBody },
                { visible: "borderVisible", up: "borderUpColor", down: "borderDownColor", label: copy.marketReplay.candleBorder },
                { visible: "wickVisible", up: "wickUpColor", down: "wickDownColor", label: copy.marketReplay.candleWick },
              ] as const).map(row => <div key={row.visible} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] items-center gap-2 rounded-md border px-3 py-2">
                <label htmlFor={`${id}-${row.visible}`} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                  <input id={`${id}-${row.visible}`} type="checkbox" checked={draft[row.visible]}
                    onChange={event => onDraftChange({ ...draft, [row.visible]: event.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  {row.label}
                </label>
                {([row.up, row.down] as const).map((key, index) => <div key={key} className="flex justify-center">
                  <label htmlFor={`${id}-${key}`} className="sr-only">{copy.marketReplay.candlestickColorLabel(row.label, index === 0 ? copy.marketReplay.bullishCandle : copy.marketReplay.bearishCandle)}</label>
                  <Input id={`${id}-${key}`} type="color" value={draft[key]}
                    onInput={event => onDraftChange({ ...draft, [key]: event.currentTarget.value.toUpperCase() })}
                    onChange={event => onDraftChange({ ...draft, [key]: event.target.value.toUpperCase() })}
                    className="w-12 cursor-pointer p-1.5" />
                </div>)}
              </div>)}
            </div>
          </section>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
          <Button type="button" onClick={() => onConfirm({ ...draft })}>{copy.marketReplay.drawingConfirm}</Button>
        </div>
      </> : null}
    </Dialog>
  );
}

