"use client";

import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
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
  const selected = value ? parseISO(value) : undefined;

  return (
    <Popover.Root>
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
          className="z-[150] rounded-lg border bg-white p-3 shadow-lg"
        >
          <DayPicker
            mode="single"
            locale={zhCN}
            selected={selected}
            onSelect={(date) => date && onChange(format(date, "yyyy-MM-dd"))}
            classNames={{
              month_caption: "mb-2 text-center text-sm font-semibold",
              nav: "absolute inset-x-3 top-3 flex justify-between",
              button_previous: "rounded-md p-1 hover:bg-slate-100",
              button_next: "rounded-md p-1 hover:bg-slate-100",
              month_grid: "border-collapse text-sm",
              weekdays: "text-slate-500",
              weekday: "h-8 w-8 text-xs font-medium",
              week: "mt-1",
              day: "h-8 w-8 p-0 text-center",
              day_button: "h-8 w-8 rounded-md hover:bg-slate-100",
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
