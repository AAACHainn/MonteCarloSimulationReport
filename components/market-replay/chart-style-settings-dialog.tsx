"use client";

import { useId, type KeyboardEvent } from "react";
import { Check, ChartCandlestick, ChartLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CandlestickStyleFields } from "./candlestick-settings-dialog";
import { cloneChartDisplay, type ChartDisplayConfig, type ChartSelection } from "@/lib/market-replay/chart-display";
import { copy } from "@/lib/i18n";

type Props = {
  open: boolean; draft: ChartDisplayConfig | null; onDraftChange: (config: ChartDisplayConfig) => void;
  onClose: () => void; onConfirm: (config: ChartDisplayConfig) => void;
};
const types = ["candlestick", "line"] as const;

export function ChartStyleSettingsDialog({ open, draft, onDraftChange, onClose, onConfirm }: Props) {
  const id = useId();
  function moveType(event: KeyboardEvent<HTMLDivElement>) {
    if (!draft) return;
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? 1 : (types.indexOf(draft.chartType) + direction + 2) % 2;
    onDraftChange({ ...draft, chartType: types[index] });
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']")[index]?.focus();
  }
  return <Dialog open={open} title={copy.marketReplay.chartStyle} description={copy.marketReplay.chartStyleDescription}
    className="max-w-xl" contentClassName="flex flex-col p-0" onClose={onClose}>
    {draft ? <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <section className="space-y-3" aria-labelledby={`${id}-type`}>
          <h3 id={`${id}-type`} className="text-sm font-semibold text-foreground">{copy.marketReplay.chartType}</h3>
          <div role="radiogroup" aria-labelledby={`${id}-type`} className="grid grid-cols-2 gap-3" onKeyDown={moveType}>
            {types.map(type => {
              const selected = type === draft.chartType;
              const Icon = type === "candlestick" ? ChartCandlestick : ChartLine;
              return <Button key={type} type="button" variant="outline" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
                onClick={() => onDraftChange({ ...draft, chartType: type })}
                className={`relative h-auto flex-col gap-2 py-3 ${selected ? "border-primary bg-blue-50 text-blue-700 ring-1 ring-primary hover:bg-blue-50 dark:bg-info-background dark:text-link dark:hover:bg-info-background" : "text-secondary-text"}`}>
                <Icon className="h-9 w-16" strokeWidth={1.5} aria-hidden="true" />
                {copy.marketReplay.chartTypes[type]}
                {selected ? <Check className="absolute right-2 top-2 h-4 w-4" aria-hidden="true" /> : null}
              </Button>;
            })}
          </div>
        </section>
        <div className="border-t pt-4">
          {draft.chartType === "candlestick"
            ? <CandlestickStyleFields draft={draft.candlestickStyle} onDraftChange={style => onDraftChange({ ...draft, candlestickStyle: style })} />
            : <section className="space-y-4">
              <div className="flex items-center gap-4 rounded-md border bg-muted px-3 py-2">
                <p className="flex-1 text-sm font-semibold text-secondary-text">{copy.marketReplay.candlestickPreview}</p>
                <svg viewBox="0 0 180 56" className="h-14 w-48" aria-hidden="true">
                  <path d={draft.line.priceSource === "close" ? "M 4 44 L 32 30 L 60 36 L 88 16 L 116 24 L 144 8 L 176 18" : "M 4 36 L 32 40 L 60 20 L 88 28 L 116 12 L 144 22 L 176 6"}
                    fill="none" stroke={draft.line.color} strokeWidth="2" />
                </svg>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-source`}>{copy.marketReplay.linePriceSource}</Label>
                <Select value={draft.line.priceSource} onValueChange={value => onDraftChange({ ...draft, line: { ...draft.line, priceSource: value as ChartSelection["line"]["priceSource"] } })}>
                  <SelectTrigger id={`${id}-source`}><SelectValue /></SelectTrigger>
                  <SelectContent onEscapeKeyDown={event => event.stopPropagation()}>
                    <SelectItem value="close">{copy.marketReplay.linePriceSources.close}</SelectItem>
                    <SelectItem value="open">{copy.marketReplay.linePriceSources.open}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-color`}>{copy.marketReplay.lineColor}</Label>
                <div className="flex items-center gap-3">
                  <Input id={`${id}-color`} type="color" value={draft.line.color} className="w-12 cursor-pointer p-1.5"
                    onInput={event => onDraftChange({ ...draft, line: { ...draft.line, color: event.currentTarget.value.toUpperCase() } })}
                    onChange={event => onDraftChange({ ...draft, line: { ...draft.line, color: event.target.value.toUpperCase() } })} />
                  <span className="font-mono text-sm text-secondary-text">{draft.line.color}</span>
                </div>
              </div>
            </section>}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
        <Button type="button" onClick={() => onConfirm(cloneChartDisplay(draft))}>{copy.marketReplay.drawingConfirm}</Button>
      </div>
    </> : null}
  </Dialog>;
}
