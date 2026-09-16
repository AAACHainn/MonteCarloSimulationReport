"use client";

import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnFilterPopover } from "@/components/ui/column-filter-popover";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };

export function MultiOptionFilterPopover({
  id,
  label,
  conditionLabel,
  values,
  options,
  openFilter,
  setOpenFilter,
  onChange,
  onClear,
  disabled,
}: {
  id: string;
  label: string;
  conditionLabel?: string;
  values: string[];
  options: FilterOption[];
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  onChange: (values: string[]) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const selected = new Set(values);

  function toggle(value: string) {
    onChange(selected.has(value)
      ? values.filter((current) => current !== value)
      : [...values, value]);
  }

  return (
    <ColumnFilterPopover
      id={id}
      openFilter={openFilter}
      setOpenFilter={setOpenFilter}
      active={values.length > 0}
      label={label}
      disabled={disabled}
    >
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500">{conditionLabel ?? label}</p>
        <div className="max-h-64 overflow-auto rounded-md border p-1">
          {options.map((option) => {
            const isSelected = selected.has(option.value);
            return <button
              key={option.value}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100",
                isSelected && "font-medium text-slate-950",
              )}
              aria-pressed={isSelected}
              onClick={() => toggle(option.value)}
            >
              <span className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                isSelected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent",
              )}>
                <Check className="h-3 w-3" />
              </span>
              <span className="truncate">{option.label}</span>
            </button>;
          })}
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onClear} disabled={values.length === 0}>
          <RotateCcw className="h-3.5 w-3.5" />
          {copy.tradeJournals.filters.clearColumn}
        </Button>
      </div>
    </ColumnFilterPopover>
  );
}
