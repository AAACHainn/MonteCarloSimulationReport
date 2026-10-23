"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { calendarDateTimeInput, normalizeDateInput, normalizeTimeInput, splitDateTimeInput, validateDateTimeInput } from "@/lib/date-time-input";

function calendarDate(value: string) {
  const normalized = normalizeDateInput(value);
  return normalized ? new Date(`${normalized}T12:00:00`) : undefined;
}

export type DateTimePickerHandle = { validate: () => string | null };

/** Shared wall-clock editor. Call validate() before submitting; callers own timezone conversion. */
export const DateTimePicker = forwardRef<DateTimePickerHandle, {
  value: string; minimum: string; maximum: string; disabled?: boolean; describedBy?: string; calendarDefaultOpen?: boolean;
  calendarActions?: ReactNode;
  onChange: (value: string) => void;
}>(function DateTimePicker({ value, minimum, maximum, disabled = false, describedBy, calendarDefaultOpen = true, calendarActions, onChange }, ref) {
  const id = useId();
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(calendarDefaultOpen);
  const selected = splitDateTimeInput(value);
  const min = splitDateTimeInput(minimum);
  const max = splitDateTimeInput(maximum);
  const selectedDate = calendarDate(selected.date);
  const minimumDate = calendarDate(min.date)!;
  const maximumDate = calendarDate(max.date)!;
  const selectedDay = selectedDate?.getTime();
  const minimumDay = minimumDate.getTime();
  const maximumDay = maximumDate.getTime();
  const [displayMonth, setDisplayMonth] = useState(() => selectedDate ?? minimumDate);
  useEffect(() => {
    if (selectedDay !== undefined) setDisplayMonth(new Date(Math.min(maximumDay, Math.max(minimumDay, selectedDay))));
  }, [selectedDay, minimumDay, maximumDay]);

  const validation = validateDateTimeInput(value, minimum, maximum);
  const error = showErrors ? validation.error : null;
  const errorId = `${id}-error`;
  const inputDescription = [describedBy, `${id}-format`, error ? errorId : ""].filter(Boolean).join(" ");
  useImperativeHandle(ref, () => ({
    validate() {
      setShowErrors(true);
      if (validation.error) {
        const date = normalizeDateInput(selected.date);
        const dateOutsideRange = date && (date < min.date || date > max.date);
        (validation.error === "date" || dateOutsideRange ? dateRef : timeRef).current?.focus();
      }
      return validation.value;
    },
  }));

  function update(date: string, time: string) { onChange(`${date}T${time}`); }
  function finishDate() {
    setShowErrors(true);
    update(normalizeDateInput(selected.date) ?? selected.date, selected.time);
  }
  function finishTime() {
    setShowErrors(true);
    update(selected.date, normalizeTimeInput(selected.time) ?? selected.time);
  }
  const firstMonth = new Date(minimumDate.getFullYear(), minimumDate.getMonth(), 1);
  const lastMonth = new Date(maximumDate.getFullYear(), maximumDate.getMonth(), 1);
  const monthStart = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-date`}>{copy.marketReplay.startDate}</Label>
          <Input ref={dateRef} id={`${id}-date`} type="text" required inputMode="text" autoComplete="off" spellCheck={false}
            className="min-w-0 px-2 tabular-nums" placeholder={copy.dateTimePicker.dateFormat}
            value={selected.date} disabled={disabled} aria-describedby={inputDescription}
            aria-invalid={error === "date" || error === "range" || undefined}
            onBlur={finishDate} onChange={(event) => update(event.target.value, selected.time)} />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-time`}>{copy.marketReplay.startTime}</Label>
          <Input ref={timeRef} id={`${id}-time`} type="text" required inputMode="text" autoComplete="off" spellCheck={false}
            className="min-w-0 px-2 tabular-nums" placeholder={copy.dateTimePicker.timeFormat}
            value={selected.time} disabled={disabled} aria-describedby={inputDescription}
            aria-invalid={error === "time" || error === "range" || undefined}
            onBlur={finishTime} onChange={(event) => update(selected.date, event.target.value)} />
        </div>
      </div>
      <p id={`${id}-format`} className="text-xs text-slate-500">{copy.dateTimePicker.formatHint}</p>
      {error ? <p id={errorId} role="alert" className="text-xs text-red-600">{copy.dateTimePicker.errors[error]}</p> : null}
      {!calendarDefaultOpen || calendarActions ? <div className="flex flex-wrap items-center gap-2">
      {!calendarDefaultOpen ? <Button type="button" variant="outline" disabled={disabled} aria-expanded={calendarOpen} aria-controls={`${id}-calendar`} onClick={() => setCalendarOpen(open => !open)}>
        <CalendarDays className="h-4 w-4" aria-hidden="true" />{calendarOpen ? copy.dateTimePicker.hideCalendar : copy.dateTimePicker.showCalendar}
      </Button> : null}
      {calendarActions}
      </div> : null}
      {calendarOpen ? <div id={`${id}-calendar`} className="rounded-lg border border-slate-200 p-3">
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
          required
          locale={zhCN}
          hideNavigation
          month={displayMonth}
          startMonth={firstMonth}
          endMonth={lastMonth}
          selected={selectedDate}
          disabled={disabled ? true : { before: minimumDate, after: maximumDate }}
          onMonthChange={setDisplayMonth}
          onSelect={(date) => { if (date) onChange(calendarDateTimeInput(format(date, "yyyy-MM-dd"), value, minimum, maximum)); }}
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
      </div> : null}
    </div>
  );
});
