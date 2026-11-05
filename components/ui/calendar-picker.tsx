"use client";

import { useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Props = {
  mode: "month" | "date";
  value: string;
  onChange: (value: string) => void;
  minMonth?: string;
  maxMonth?: string;
  disabled?: boolean;
};

const t = copy.tradeJournals.datePicker;
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function CalendarPicker({ mode, minMonth = "1900-01", maxMonth = "2100-12", ...props }: Props) {
  if (mode === "date") return <DatePicker {...props} minMonth={minMonth} maxMonth={maxMonth} closeOnSelect />;
  return <MonthPicker {...props} minMonth={minMonth} maxMonth={maxMonth} />;
}

function MonthPicker({ value, onChange, minMonth, maxMonth, disabled = false }: Omit<Props, "mode" | "minMonth" | "maxMonth"> & {
  minMonth: string;
  maxMonth: string;
}) {
  const selected = parseISO(value);
  const hasSelection = isValid(selected);
  const selectedMonth = hasSelection ? format(selected, "yyyy-MM") : "";
  const fallback = selectedMonth || format(new Date(), "yyyy-MM");
  const anchor = fallback < minMonth ? minMonth : fallback > maxMonth ? maxMonth : fallback;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(anchor.slice(0, 4)));
  const inRange = (month: string) => month >= minMonth && month <= maxMonth;
  const adjacent = (offset: number) => format(new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5)) - 1 + offset, 1), "yyyy-MM");
  const label = hasSelection ? t.yearMonthLabel(selected.getFullYear(), selected.getMonth() + 1) : t.monthSelect;
  const stepMonth = (offset: number) => {
    const next = adjacent(offset);
    if (inRange(next)) onChange(next);
  };
  const iconClass = "rounded-none border-0 text-slate-600 dark:text-secondary-text";

  return <Popover.Root open={open} onOpenChange={next => {
    setOpen(next);
    if (next) setYear(Number(anchor.slice(0, 4)));
  }}>
    <div className="inline-flex items-stretch rounded-md border bg-white dark:bg-surface-raised">
      <Button type="button" variant="ghost" size="icon" className={iconClass}
        aria-label={t.previousMonth} disabled={disabled || !inRange(adjacent(-1))} onClick={() => stepMonth(-1)}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" disabled={disabled}
          className="gap-2 rounded-none border-x bg-white dark:bg-surface-raised px-4 font-semibold text-slate-950 dark:text-foreground hover:bg-white dark:hover:bg-surface-raised data-[state=open]:bg-blue-50 dark:data-[state=open]:bg-info-background">
          <CalendarDays className="text-blue-700 dark:text-link" aria-hidden="true" />{label}
          <ChevronDown className={cn("text-slate-600 dark:text-secondary-text transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Button type="button" variant="ghost" size="icon" className={iconClass}
        aria-label={t.nextMonth} disabled={disabled || !inRange(adjacent(1))} onClick={() => stepMonth(1)}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
    <Popover.Portal>
      <Popover.Content align="start" sideOffset={8} collisionPadding={12}
        className="z-[150] w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-white dark:bg-surface-raised p-4 shadow-lg">
        <p className="mb-2 text-sm font-medium text-slate-600 dark:text-secondary-text">{t.monthSelect}</p>
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="icon" aria-label={t.previousYear}
            disabled={monthKey(year - 1, 12) < minMonth} onClick={() => setYear(year - 1)}><ChevronLeft aria-hidden="true" /></Button>
          <p className="font-semibold tabular-nums" aria-live="polite">{t.yearLabel(year)}</p>
          <Button type="button" variant="outline" size="icon" aria-label={t.nextYear}
            disabled={monthKey(year + 1, 1) > maxMonth} onClick={() => setYear(year + 1)}><ChevronRight aria-hidden="true" /></Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            const key = monthKey(year, month);
            const current = key === selectedMonth;
            return <Button key={key} type="button" variant="ghost" disabled={!inRange(key)} aria-pressed={current}
              className={cn("bg-slate-50 dark:bg-muted disabled:opacity-40", current && "border border-blue-200 dark:border-link/40 bg-blue-50 dark:bg-info-background font-semibold text-blue-700 dark:text-link")}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}>{t.monthLabel(month)}</Button>;
          })}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
