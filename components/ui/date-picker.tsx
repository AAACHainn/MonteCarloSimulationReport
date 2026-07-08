"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/i18n";

export function DatePicker({
  value,
  onChange,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const yearInputId = useId();
  const yearPickerRef = useRef<HTMLDivElement | null>(null);
  const today = useMemo(() => new Date(), []);
  const selected = useMemo(() => {
    if (!value) return undefined;
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : undefined;
  }, [value]);
  const [isOpen, setIsOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => toMonthStart(selected ?? today));
  const [yearInput, setYearInput] = useState(() => String(displayMonth.getFullYear()));
  const [isYearListOpen, setIsYearListOpen] = useState(false);

  const navigationStart = useMemo(() => new Date(1900, 0, 1), []);
  const navigationEnd = useMemo(() => new Date(today.getFullYear() + 20, 11, 31), [today]);
  const startYear = navigationStart.getFullYear();
  const endYear = navigationEnd.getFullYear();
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, index) => ({
      label: format(new Date(2024, index, 1), "LLLL", { locale: zhCN }),
      value: String(index),
    })),
    [],
  );
  const yearOptions = useMemo(
    () => {
      const inputYear = Number(yearInput);
      const anchorYear = Number.isInteger(inputYear) && yearInput.length >= 4
        ? Math.min(Math.max(inputYear, startYear), endYear)
        : displayMonth.getFullYear();
      const firstYear = Math.max(startYear, anchorYear - 10);
      const lastYear = Math.min(endYear, anchorYear + 10);
      return Array.from(
        { length: lastYear - firstYear + 1 },
        (_, index) => firstYear + index,
      );
    },
    [displayMonth, endYear, startYear, yearInput],
  );
  const canGoPrevious = displayMonth > navigationStart;
  const canGoNext = displayMonth < toMonthStart(navigationEnd);

  const normalizeYearInput = useCallback(() => {
    const year = Number(yearInput);
    if (
      !Number.isInteger(year)
      || year < startYear
      || year > endYear
    ) {
      setYearInput(String(displayMonth.getFullYear()));
    }
  }, [displayMonth, endYear, startYear, yearInput]);

  useEffect(() => {
    if (!isOpen) return;
    const nextMonth = toMonthStart(selected ?? today);
    setDisplayMonth(nextMonth);
    setYearInput(String(nextMonth.getFullYear()));
  }, [isOpen, selected, today]);

  useEffect(() => {
    if (!isOpen) setIsYearListOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isYearListOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (yearPickerRef.current?.contains(target)) return;
      setIsYearListOpen(false);
      normalizeYearInput();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isYearListOpen, normalizeYearInput]);

  function handleMonthChange(month: Date) {
    const nextMonth = toMonthStart(month);
    setDisplayMonth(nextMonth);
    setYearInput(String(nextMonth.getFullYear()));
  }

  function handleYearInputChange(rawValue: string) {
    setYearInput(rawValue);
    const year = Number(rawValue);
    if (!Number.isInteger(year) || rawValue.length < 4) return;
    if (year < startYear || year > endYear) return;
    setDisplayMonth(toMonthStart(new Date(year, displayMonth.getMonth(), 1)));
  }

  function handleYearSelect(year: number) {
    setIsYearListOpen(false);
    setYearInput(String(year));
    setDisplayMonth(toMonthStart(new Date(year, displayMonth.getMonth(), 1)));
  }

  function handleMonthSelect(month: string) {
    const nextMonth = toMonthStart(new Date(displayMonth.getFullYear(), Number(month), 1));
    setDisplayMonth(nextMonth);
  }

  function goToPreviousMonth() {
    if (!canGoPrevious) return;
    handleMonthChange(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1));
  }

  function goToNextMonth() {
    if (!canGoNext) return;
    handleMonthChange(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1));
  }

  function handleSelect(date: Date | undefined) {
    if (!date) return;
    const nextMonth = toMonthStart(date);
    setDisplayMonth(nextMonth);
    setYearInput(String(nextMonth.getFullYear()));
    onChange(format(date, "yyyy-MM-dd"));
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="outline" className={cn("w-36 justify-start px-3 font-normal", className)} disabled={disabled}>
          <CalendarDays className="h-4 w-4 text-slate-500" />
          {selected ? format(selected, "yyyy-MM-dd") : copy.tradeJournals.chooseDate}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-date-picker-popover
          align="start"
          sideOffset={6}
          className="z-[150] w-[18rem] rounded-md border bg-white p-3 shadow-lg"
        >
          <div className="mb-3 flex items-center gap-2 rounded-md bg-slate-50 p-1.5">
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white hover:text-slate-950 disabled:pointer-events-none disabled:text-slate-300"
              onClick={goToPreviousMonth}
              disabled={!canGoPrevious}
              aria-label={copy.tradeJournals.datePicker.previousMonth}
              title={copy.tradeJournals.datePicker.previousMonth}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="grid min-w-0 flex-1 grid-cols-[5.25rem_minmax(0,1fr)] gap-1.5">
              <div ref={yearPickerRef} className="relative min-w-0">
                <label htmlFor={yearInputId} className="sr-only">
                  {copy.tradeJournals.datePicker.yearInput}
                </label>
                <input
                  id={yearInputId}
                  type="text"
                  inputMode="numeric"
                  value={yearInput}
                  onChange={(event) => handleYearInputChange(event.target.value)}
                  onFocus={() => setIsYearListOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setIsYearListOpen(false);
                      normalizeYearInput();
                    }
                  }}
                  placeholder={copy.tradeJournals.datePicker.yearInputPlaceholder}
                  aria-label={copy.tradeJournals.datePicker.yearInputPlaceholder}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-center text-sm font-medium tabular-nums text-slate-950 outline-none transition-colors placeholder:font-normal focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                {isYearListOpen ? (
                  <div
                    data-date-picker-popover
                    className="absolute left-0 top-9 z-[200] max-h-52 w-full overflow-auto rounded-md border bg-white p-1 text-sm shadow-md"
                  >
                    {yearOptions.map((year) => (
                      <button
                        key={year}
                        type="button"
                        className={cn(
                          "flex h-8 w-full items-center justify-center rounded-sm px-2 font-medium tabular-nums text-slate-700 outline-none transition-colors hover:bg-slate-100",
                          year === displayMonth.getFullYear() && "bg-blue-50 text-blue-700",
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleYearSelect(year)}
                      >
                        {year}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Select
                value={String(displayMonth.getMonth())}
                onValueChange={handleMonthSelect}
              >
                <SelectTrigger
                  aria-label={copy.tradeJournals.datePicker.monthSelect}
                  className="h-8 min-w-0 border-slate-200 bg-white px-2 text-sm font-medium focus:ring-blue-100"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent data-date-picker-popover className="z-[200] min-w-[6.25rem]">
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white hover:text-slate-950 disabled:pointer-events-none disabled:text-slate-300"
              onClick={goToNextMonth}
              disabled={!canGoNext}
              aria-label={copy.tradeJournals.datePicker.nextMonth}
              title={copy.tradeJournals.datePicker.nextMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <DayPicker
            mode="single"
            locale={zhCN}
            hideNavigation
            startMonth={navigationStart}
            endMonth={navigationEnd}
            month={displayMonth}
            selected={selected}
            onMonthChange={handleMonthChange}
            onSelect={handleSelect}
            classNames={{
              root: "w-full",
              month_caption: "sr-only",
              nav: "hidden",
              button_previous: "rounded-md p-1 hover:bg-slate-100",
              button_next: "rounded-md p-1 hover:bg-slate-100",
              month_grid: "w-full border-collapse text-sm",
              weekdays: "text-slate-500",
              weekday: "h-8 text-xs font-medium",
              week: "mt-1",
              day: "h-8 p-0 text-center",
              day_button: "mx-auto h-8 w-8 rounded-md text-slate-900 transition-colors hover:bg-slate-100",
              selected: "[&_button]:bg-blue-600 [&_button]:text-white [&_button]:hover:bg-blue-700",
              today: "[&_button]:font-semibold [&_button]:text-blue-700",
              outside: "text-slate-300",
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function toMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
