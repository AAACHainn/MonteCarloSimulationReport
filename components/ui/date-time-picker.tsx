"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";

const manualInputClassName = "min-w-0 px-2 tabular-nums [&::-webkit-calendar-picker-indicator]:hidden";

function preventNativePicker(event: KeyboardEvent<HTMLInputElement>) {
  // Keep segmented typing and validation, while the inline calendar owns date selection.
  if (event.altKey && event.key === "ArrowDown") event.preventDefault();
}

function parts(value: string) {
  const [date = "", time = ""] = value.split("T");
  return { date, time: time.length === 5 ? `${time}:00` : time };
}

function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

/** Date and time values are wall-clock strings; conversion to an instant belongs to the caller. */
export function DateTimePicker({ value, minimum, maximum, disabled = false, describedBy, onChange }: {
  value: string;
  minimum: string;
  maximum: string;
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const selected = parts(value);
  const min = parts(minimum);
  const max = parts(maximum);
  const selectedDate = useMemo(() => calendarDate(selected.date), [selected.date]);
  const minimumDate = useMemo(() => calendarDate(min.date), [min.date]);
  const maximumDate = useMemo(() => calendarDate(max.date), [max.date]);
  const [displayMonth, setDisplayMonth] = useState(selectedDate);

  useEffect(() => {
    if (Number.isFinite(selectedDate.getTime())) setDisplayMonth(selectedDate);
  }, [selectedDate]);

  function update(date: string, time: string) {
    onChange(`${date}T${time}`);
  }

  const firstMonth = new Date(minimumDate.getFullYear(), minimumDate.getMonth(), 1);
  const lastMonth = new Date(maximumDate.getFullYear(), maximumDate.getMonth(), 1);
  const monthStart = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-date`}>{copy.marketReplay.startDate}</Label>
          <Input id={`${id}-date`} type="date" className={manualInputClassName} min={min.date} max={max.date} value={selected.date} disabled={disabled} aria-describedby={describedBy} onKeyDown={preventNativePicker} onChange={(event) => update(event.target.value, selected.time)} />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-time`}>{copy.marketReplay.startTime}</Label>
          <Input id={`${id}-time`} type="time" className={manualInputClassName} step="1" min={selected.date === min.date ? min.time : undefined} max={selected.date === max.date ? max.time : undefined} value={selected.time} disabled={disabled} aria-describedby={describedBy} onKeyDown={preventNativePicker} onChange={(event) => update(selected.date, event.target.value)} />
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button type="button" variant="ghost" size="icon" aria-label={copy.marketReplay.previousMonth} disabled={disabled || monthStart <= firstMonth} onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="text-sm font-semibold tabular-nums text-slate-950">{format(displayMonth, "M月 yyyy", { locale: zhCN })}</span>
          <Button type="button" variant="ghost" size="icon" aria-label={copy.marketReplay.nextMonth} disabled={disabled || monthStart >= lastMonth} onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <DayPicker
          mode="single"
          locale={zhCN}
          hideNavigation
          month={displayMonth}
          startMonth={firstMonth}
          endMonth={lastMonth}
          selected={Number.isFinite(selectedDate.getTime()) ? selectedDate : undefined}
          disabled={disabled ? true : { before: minimumDate, after: maximumDate }}
          onMonthChange={setDisplayMonth}
          onSelect={(date) => { if (date) update(format(date, "yyyy-MM-dd"), selected.time); }}
          classNames={{
            root: "w-full",
            month_caption: "sr-only",
            nav: "hidden",
            month_grid: "w-full border-collapse text-sm",
            weekdays: "text-slate-500",
            weekday: "h-8 text-xs font-medium",
            day: "h-10 p-0 text-center",
            day_button: "mx-auto h-10 w-full max-w-10 rounded-md text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected: "[&_button]:bg-primary [&_button]:font-semibold [&_button]:text-primary-foreground [&_button]:hover:bg-blue-700",
            outside: "text-slate-300",
            disabled: "[&_button]:cursor-not-allowed [&_button]:text-slate-300",
          }}
        />
      </div>
    </div>
  );
}
