"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";

function parts(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/.exec(value);
  return match ? { date: match[1], time: match[2].length === 5 ? `${match[2]}:00` : match[2] } : null;
}

function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function clampDateTime(value: string, minimum: string, maximum: string) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

export function ReplayStartDialog({
  open,
  value,
  minimum,
  maximum,
  timezone,
  busy,
  error,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  value: string;
  minimum: string;
  maximum: string;
  timezone: string;
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const selectedParts = parts(value) ?? parts(minimum)!;
  const minimumParts = parts(minimum)!;
  const maximumParts = parts(maximum)!;
  const selectedDate = useMemo(() => calendarDate(selectedParts.date), [selectedParts.date]);
  const minimumDate = useMemo(() => calendarDate(minimumParts.date), [minimumParts.date]);
  const maximumDate = useMemo(() => calendarDate(maximumParts.date), [maximumParts.date]);
  const [displayMonth, setDisplayMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    setDisplayMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [open, selectedDate]);

  function update(date: string, time: string) {
    onChange(clampDateTime(`${date}T${time}`, minimum, maximum));
  }

  function previousMonth() {
    setDisplayMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }

  function nextMonth() {
    setDisplayMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  }

  const firstVisibleMonth = new Date(minimumDate.getFullYear(), minimumDate.getMonth(), 1);
  const lastVisibleMonth = new Date(maximumDate.getFullYear(), maximumDate.getMonth(), 1);
  const canGoPrevious = displayMonth > firstVisibleMonth;
  const canGoNext = displayMonth < lastVisibleMonth;

  return (
    <Dialog
      open={open}
      title={copy.marketReplay.selectReplayDate}
      description={copy.marketReplay.selectReplayDateDescription}
      className="max-w-sm"
      onClose={() => { if (!busy) onCancel(); }}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_8.5rem] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="replay-start-date">{copy.marketReplay.startDate}</Label>
            <Input
              id="replay-start-date"
              type="date"
              min={minimumParts.date}
              max={maximumParts.date}
              value={selectedParts.date}
              disabled={busy}
              onChange={(event) => update(event.target.value, selectedParts.time)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="replay-start-time">{copy.marketReplay.startTime}</Label>
            <Input
              id="replay-start-time"
              type="time"
              step="1"
              value={selectedParts.time}
              disabled={busy}
              onChange={(event) => update(selectedParts.date, event.target.value)}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={copy.marketReplay.previousMonth}
              disabled={!canGoPrevious || busy}
              onClick={previousMonth}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-slate-900">{format(displayMonth, "M月 yyyy", { locale: zhCN })}</span>
            <button
              type="button"
              aria-label={copy.marketReplay.nextMonth}
              disabled={!canGoNext || busy}
              onClick={nextMonth}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:text-slate-300"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <DayPicker
            mode="single"
            locale={zhCN}
            hideNavigation
            month={displayMonth}
            startMonth={firstVisibleMonth}
            endMonth={lastVisibleMonth}
            selected={selectedDate}
            disabled={{ before: minimumDate, after: maximumDate }}
            onMonthChange={setDisplayMonth}
            onSelect={(date) => {
              if (date) update(format(date, "yyyy-MM-dd"), selectedParts.time);
            }}
            classNames={{
              root: "w-full",
              month_caption: "sr-only",
              nav: "hidden",
              month_grid: "w-full border-collapse text-sm",
              weekdays: "text-slate-500",
              weekday: "h-8 text-xs font-medium",
              week: "mt-1",
              day: "h-9 p-0 text-center",
              day_button: "mx-auto h-9 w-9 rounded-md text-slate-900 transition-colors hover:bg-slate-100 disabled:text-slate-300",
              selected: "[&_button]:bg-slate-900 [&_button]:font-semibold [&_button]:text-white [&_button]:hover:bg-slate-800",
              outside: "text-slate-300",
              disabled: "[&_button]:cursor-not-allowed [&_button]:text-slate-300",
            }}
          />
        </div>

        <Button
          type="button"
          variant="secondary"
          className="mx-auto flex"
          disabled={busy}
          onClick={() => onChange(minimum)}
        >
          {copy.marketReplay.firstAvailableDate}
        </Button>
        <p className="text-center text-xs text-slate-500">{timezone} · {minimum.replace("T", " ")} – {maximum.replace("T", " ")}</p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{copy.common.cancel}</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>{busy ? copy.marketReplay.selectingReplayDate : copy.marketReplay.selectReplayDateConfirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}
