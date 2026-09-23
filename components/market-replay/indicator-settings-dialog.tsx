"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Activity, BarChart3, Clock3, Hash, Plus, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import {
  ABR_LENGTH_MAX,
  ABR_LENGTH_MIN,
  BAR_COUNT_INTERVAL_MAX,
  BAR_COUNT_INTERVAL_MIN,
  BAR_COUNT_RECENT_TRADING_DAYS_MAX,
  BAR_COUNT_RECENT_TRADING_DAYS_MIN,
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  EMA_LINE_STYLES,
  EMA_LINE_WIDTHS,
  MAX_EMA_INDICATORS,
  type BarCountIndicatorConfig,
  type EmaIndicatorConfig,
  type EmaLineStyle,
  type EmaLineWidth,
} from "@/lib/market-replay/types";

type IndicatorId = "countdown" | "volume" | "bar-count" | "abr" | "ema";

type IndicatorSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  candleCountdown?: {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
  };
  volumeVisible: boolean;
  onVolumeVisibleChange: (visible: boolean) => void;
  barCountConfig: BarCountIndicatorConfig;
  setBarCountConfig: Dispatch<SetStateAction<BarCountIndicatorConfig>>;
  onBarCountRecentTradingDaysChange: (value: number) => boolean | void;
  onBarCountIntervalChange: (value: number) => boolean | void;
  barCountError?: string | null;
  abrEnabled: boolean;
  onAbrEnabledChange: (enabled: boolean) => void;
  abrLength: number;
  onAbrLengthChange: (value: number) => boolean | void;
  abrError?: string | null;
  emaEnabled: boolean;
  onEmaEnabledChange: (enabled: boolean) => void;
  emaIndicators: EmaIndicatorConfig[];
  setEmaIndicators: Dispatch<SetStateAction<EmaIndicatorConfig[]>>;
  onEmaLengthChange: (id: string, value: number) => boolean | void;
  onAddEma: () => void;
  emaError?: string | null;
};

function SettingSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${checked ? "bg-blue-600" : "bg-slate-300"}`}
    >
      <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-center">
      <Label htmlFor={id} className="text-xs text-slate-500">{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-9 w-14 cursor-pointer p-1" />
        <span className="font-mono text-xs text-slate-500">{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

export function IndicatorSettingsDialog({
  open,
  onClose,
  candleCountdown,
  volumeVisible,
  onVolumeVisibleChange,
  barCountConfig,
  setBarCountConfig,
  onBarCountRecentTradingDaysChange,
  onBarCountIntervalChange,
  barCountError,
  abrEnabled,
  onAbrEnabledChange,
  abrLength,
  onAbrLengthChange,
  abrError,
  emaEnabled,
  onEmaEnabledChange,
  emaIndicators,
  setEmaIndicators,
  onEmaLengthChange,
  onAddEma,
  emaError,
}: IndicatorSettingsDialogProps) {
  const initialIndicator: IndicatorId = candleCountdown ? "countdown" : "volume";
  const [activeIndicator, setActiveIndicator] = useState<IndicatorId>(initialIndicator);
  const [selectedEmaId, setSelectedEmaId] = useState<string | null>(emaIndicators[0]?.id ?? null);

  const indicators = useMemo(() => [
    ...(candleCountdown ? [{
      id: "countdown" as const,
      title: copy.marketReplay.candleCountdownTitle,
      description: copy.marketReplay.candleCountdownDescription,
      enabled: candleCountdown.enabled,
      icon: Clock3,
    }] : []),
    {
      id: "volume" as const,
      title: copy.marketReplay.volumeTitle,
      description: copy.marketReplay.volumeDescription,
      enabled: volumeVisible,
      icon: BarChart3,
    },
    {
      id: "bar-count" as const,
      title: copy.marketReplay.barCountTitle,
      description: copy.marketReplay.barCountDescription,
      enabled: barCountConfig.enabled,
      icon: Hash,
    },
    {
      id: "abr" as const,
      title: copy.marketReplay.abrTitle,
      description: copy.marketReplay.abrDescription,
      enabled: abrEnabled,
      icon: Activity,
    },
    {
      id: "ema" as const,
      title: copy.marketReplay.emaTitle,
      description: copy.marketReplay.emaDescription,
      enabled: emaEnabled,
      icon: TrendingUp,
    },
  ], [abrEnabled, barCountConfig.enabled, candleCountdown, emaEnabled, volumeVisible]);

  useEffect(() => {
    if (!indicators.some((indicator) => indicator.id === activeIndicator)) {
      setActiveIndicator(initialIndicator);
    }
  }, [activeIndicator, indicators, initialIndicator]);

  const selectedEma = emaIndicators.find((indicator) => indicator.id === selectedEmaId) ?? emaIndicators[0] ?? null;
  const active = indicators.find((indicator) => indicator.id === activeIndicator) ?? indicators[0];
  const enabledCount = indicators.filter((indicator) => indicator.enabled).length;

  const toggleActive = (enabled: boolean) => {
    if (active.id === "countdown") candleCountdown?.onChange(enabled);
    if (active.id === "volume") onVolumeVisibleChange(enabled);
    if (active.id === "bar-count") setBarCountConfig((current) => ({ ...current, enabled }));
    if (active.id === "abr") onAbrEnabledChange(enabled);
    if (active.id === "ema") onEmaEnabledChange(enabled);
  };

  const updateEma = (id: string, changes: Partial<EmaIndicatorConfig>) => {
    setEmaIndicators((current) => current.map((indicator) => indicator.id === id ? { ...indicator, ...changes } : indicator));
  };

  const removeEma = (id: string) => {
    const index = emaIndicators.findIndex((indicator) => indicator.id === id);
    const next = emaIndicators[index + 1] ?? emaIndicators[index - 1] ?? null;
    setEmaIndicators((current) => current.filter((indicator) => indicator.id !== id));
    setSelectedEmaId(next?.id ?? null);
  };

  return (
    <Dialog
      open={open}
      title={copy.marketReplay.indicatorSettings}
      description={copy.marketReplay.indicatorSettingsDescription}
      className="h-[min(44rem,calc(100dvh-2rem))] max-w-5xl"
      contentClassName="overflow-hidden p-0"
      onClose={onClose}
    >
      <div className="grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
        <aside className="border-b bg-slate-50/70 md:min-h-0 md:border-b-0 md:border-r">
          <div className="hidden items-center justify-between border-b px-3 py-2.5 md:flex">
            <p className="text-xs font-medium text-slate-600">{copy.marketReplay.indicatorList}</p>
            <span className="text-xs tabular-nums text-slate-500">{copy.marketReplay.indicatorEnabledCount(enabledCount, indicators.length)}</span>
          </div>
          <nav aria-label={copy.marketReplay.indicatorList} className="flex gap-1 overflow-x-auto p-2 md:block md:h-[calc(100%-2.5rem)] md:space-y-1 md:overflow-y-auto">
            {indicators.map((indicator) => {
              const Icon = indicator.icon;
              const selected = indicator.id === active.id;
              return (
                <button
                  key={indicator.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setActiveIndicator(indicator.id)}
                  className={`flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:w-full md:min-w-0 ${selected ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${selected ? "text-blue-600" : "text-slate-400"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm font-medium md:truncate">{indicator.title}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${indicator.enabled ? "bg-blue-600" : "bg-slate-300"}`} aria-hidden="true" />
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          <header className="flex shrink-0 items-start gap-4 border-b px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-blue-700">{copy.marketReplay.indicatorConfiguration}</p>
              <h3 className="mt-0.5 text-base font-semibold text-slate-950">{active.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{active.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-1">
              <span className="hidden text-xs text-slate-500 sm:inline">{active.enabled ? copy.marketReplay.emaOn : copy.marketReplay.emaOff}</span>
              <SettingSwitch checked={active.enabled} label={active.title} onChange={toggleActive} />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {active.id === "countdown" || active.id === "volume" ? (
              <div className="rounded-md border border-dashed bg-slate-50 p-5 text-sm text-slate-600">
                {copy.marketReplay.indicatorNoAdditionalOptions}
              </div>
            ) : null}

            {active.id === "bar-count" ? (
              <div className="max-w-xl space-y-4">
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-center">
                  <Label htmlFor="indicator-bar-count-days" className="text-xs text-slate-500">{copy.marketReplay.barCountRecentTradingDays}</Label>
                  <Input
                    key={barCountConfig.recentTradingDays}
                    id="indicator-bar-count-days"
                    type="number"
                    min={BAR_COUNT_RECENT_TRADING_DAYS_MIN}
                    max={BAR_COUNT_RECENT_TRADING_DAYS_MAX}
                    step="1"
                    defaultValue={barCountConfig.recentTradingDays}
                    aria-describedby={barCountError ? "indicator-bar-count-error" : undefined}
                    onBlur={(event) => {
                      if (onBarCountRecentTradingDaysChange(Number(event.currentTarget.value)) === false) {
                        event.currentTarget.value = String(barCountConfig.recentTradingDays);
                      }
                    }}
                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    className="h-9 w-28 font-mono text-xs"
                  />
                  <Label htmlFor="indicator-bar-count-interval" className="text-xs text-slate-500">{copy.marketReplay.barCountInterval}</Label>
                  <Input
                    key={barCountConfig.interval}
                    id="indicator-bar-count-interval"
                    type="number"
                    min={BAR_COUNT_INTERVAL_MIN}
                    max={BAR_COUNT_INTERVAL_MAX}
                    step="1"
                    defaultValue={barCountConfig.interval}
                    aria-describedby={barCountError ? "indicator-bar-count-error" : undefined}
                    onBlur={(event) => {
                      if (onBarCountIntervalChange(Number(event.currentTarget.value)) === false) {
                        event.currentTarget.value = String(barCountConfig.interval);
                      }
                    }}
                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    className="h-9 w-28 font-mono text-xs"
                  />
                </div>
                <div className="space-y-3 border-t pt-4">
                  {([
                    ["regularColor", copy.marketReplay.barCountRegularColor],
                    ["bar18Color", copy.marketReplay.barCountBar18Color],
                    ["hourCloseColor", copy.marketReplay.barCountHourCloseColor],
                  ] as const).map(([key, label]) => (
                    <ColorField key={key} id={`indicator-bar-count-${key}`} label={label} value={barCountConfig[key]} onChange={(value) => setBarCountConfig((current) => ({ ...current, [key]: value }))} />
                  ))}
                </div>
                {barCountError ? <p id="indicator-bar-count-error" className="text-xs text-red-600" role="alert">{barCountError}</p> : null}
              </div>
            ) : null}

            {active.id === "abr" ? (
              <div className="max-w-xl space-y-4">
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-center">
                  <Label htmlFor="indicator-abr-length" className="text-xs text-slate-500">{copy.marketReplay.abrLength}</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      key={abrLength}
                      id="indicator-abr-length"
                      type="number"
                      min={ABR_LENGTH_MIN}
                      max={ABR_LENGTH_MAX}
                      step="1"
                      defaultValue={abrLength}
                      onBlur={(event) => {
                        if (onAbrLengthChange(Number(event.currentTarget.value)) === false) event.currentTarget.value = String(abrLength);
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                      className="h-9 w-28 font-mono text-xs"
                    />
                    <span className="text-xs text-slate-500">{copy.marketReplay.abrName(abrLength)}</span>
                  </div>
                </div>
                {abrError ? <p className="text-xs text-red-600" role="alert">{abrError}</p> : null}
              </div>
            ) : null}

            {active.id === "ema" ? (
              <div className="grid min-h-full gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-600">{copy.marketReplay.emaLines}</p>
                    <span className="text-xs tabular-nums text-slate-500">{emaIndicators.length}/{MAX_EMA_INDICATORS}</span>
                  </div>
                  {emaIndicators.length ? <div className="space-y-1">
                    {emaIndicators.map((indicator) => (
                      <div key={indicator.id} className={`flex items-center gap-2 rounded-md border p-2 ${selectedEma?.id === indicator.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>
                        <input
                          type="checkbox"
                          checked={indicator.visible}
                          onChange={(event) => updateEma(indicator.id, { visible: event.target.checked })}
                          aria-label={copy.marketReplay.emaLineToggle(indicator.length)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <button type="button" onClick={() => setSelectedEmaId(indicator.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: indicator.color }} aria-hidden="true" />
                          <span className="truncate text-sm font-medium text-slate-700">{copy.marketReplay.emaLine(indicator.length)}</span>
                        </button>
                      </div>
                    ))}
                  </div> : <p className="rounded-md border border-dashed p-3 text-xs text-slate-500">{copy.marketReplay.emaEmpty}</p>}
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={onAddEma} disabled={emaIndicators.length >= MAX_EMA_INDICATORS}>
                    <Plus className="h-4 w-4" />{copy.marketReplay.emaAdd}
                  </Button>
                </div>

                <div className="min-w-0 rounded-md border bg-slate-50/60 p-4">
                  {selectedEma ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3 border-b pb-3">
                        <div>
                          <p className="text-xs text-slate-500">{copy.marketReplay.emaLineSettings}</p>
                          <p className="mt-0.5 text-sm font-semibold text-slate-900">{copy.marketReplay.emaLine(selectedEma.length)}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeEma(selectedEma.id)} aria-label={copy.marketReplay.emaRemove(selectedEma.length)} className="h-8 w-8 text-slate-500">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[7rem_1fr] sm:items-center">
                        <Label htmlFor={`indicator-ema-length-${selectedEma.id}`} className="text-xs text-slate-500">{copy.marketReplay.emaLength}</Label>
                        <Input
                          key={`${selectedEma.id}-${selectedEma.length}`}
                          id={`indicator-ema-length-${selectedEma.id}`}
                          type="number"
                          min={EMA_LENGTH_MIN}
                          max={EMA_LENGTH_MAX}
                          step="1"
                          defaultValue={selectedEma.length}
                          onBlur={(event) => {
                            if (onEmaLengthChange(selectedEma.id, Number(event.currentTarget.value)) === false) event.currentTarget.value = String(selectedEma.length);
                          }}
                          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                          className="h-9 w-28 font-mono text-xs"
                        />
                        <Label htmlFor={`indicator-ema-color-${selectedEma.id}`} className="text-xs text-slate-500">{copy.marketReplay.lineColor}</Label>
                        <div className="flex items-center gap-2">
                          <Input id={`indicator-ema-color-${selectedEma.id}`} type="color" value={selectedEma.color} onChange={(event) => updateEma(selectedEma.id, { color: event.target.value.toUpperCase() })} className="h-9 w-14 cursor-pointer p-1" />
                          <span className="font-mono text-xs text-slate-500">{selectedEma.color.toUpperCase()}</span>
                        </div>
                        <Label className="text-xs text-slate-500">{copy.marketReplay.lineWidth}</Label>
                        <div className="flex flex-wrap gap-1">
                          {EMA_LINE_WIDTHS.map((lineWidth) => (
                            <button key={lineWidth} type="button" aria-label={`${copy.marketReplay.lineWidth} ${lineWidth}`} aria-pressed={selectedEma.lineWidth === lineWidth} onClick={() => updateEma(selectedEma.id, { lineWidth: lineWidth as EmaLineWidth })} className={`flex h-9 w-10 items-center justify-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${selectedEma.lineWidth === lineWidth ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                              <span className="block w-5 bg-slate-700" style={{ height: lineWidth }} />
                            </button>
                          ))}
                        </div>
                        <Label className="text-xs text-slate-500">{copy.marketReplay.lineStyle}</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {EMA_LINE_STYLES.map((lineStyle) => {
                            const label = lineStyle === "SOLID" ? copy.marketReplay.lineSolid : lineStyle === "DASHED" ? copy.marketReplay.lineDashed : copy.marketReplay.lineDotted;
                            return <button key={lineStyle} type="button" aria-pressed={selectedEma.lineStyle === lineStyle} onClick={() => updateEma(selectedEma.id, { lineStyle: lineStyle as EmaLineStyle })} className={`rounded-md border px-2 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${selectedEma.lineStyle === lineStyle ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{label}</button>;
                          })}
                        </div>
                      </div>
                    </div>
                  ) : <p className="text-sm text-slate-500">{copy.marketReplay.emaEmpty}</p>}
                </div>
                {emaError ? <p className="text-xs text-red-600 lg:col-span-2" role="alert">{emaError}</p> : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
