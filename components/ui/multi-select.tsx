"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { OptionPopoverContent } from "@/components/ui/option-popover";
import { filterSelectOptions, OptionSearch } from "@/components/ui/option-search";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
};

export function MultiSelect({
  value,
  options,
  onCommit,
  placeholder,
  emptyMessage,
  ariaLabel,
  saveLabel,
  cancelLabel,
  searchable = false,
  searchPlaceholder = copy.common.searchOptions,
  disabled = false,
  className,
}: {
  value: string[];
  options: MultiSelectOption[];
  onCommit: (values: string[]) => Promise<boolean>;
  placeholder: string;
  emptyMessage: string;
  ariaLabel: string;
  saveLabel: string;
  cancelLabel: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => filterSelectOptions(options, query), [options, query]);
  const selectedLabels = useMemo(() => {
    const selected = new Set(value);
    return options.filter((option) => selected.has(option.value)).map((option) => option.label);
  }, [options, value]);
  const draftSet = new Set(draft);
  const changed = draft.length !== value.length || draft.some((item) => !value.includes(item));

  function changeOpen(nextOpen: boolean) {
    if (saving) return;
    if (nextOpen) setDraft(value);
    setQuery("");
    setOpen(nextOpen);
  }

  function toggle(optionValue: string) {
    setDraft((current) => current.includes(optionValue)
      ? current.filter((item) => item !== optionValue)
      : [...current, optionValue]);
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await onCommit(draft);
      if (saved) setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const summary = selectedLabels.length === 0
    ? placeholder
    : selectedLabels.length <= 2
      ? selectedLabels.join("、")
      : `${selectedLabels.slice(0, 2).join("、")} +${selectedLabels.length - 2}`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={changeOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-md border border-transparent bg-transparent px-2 text-left text-sm shadow-none hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-blue-300 data-[state=open]:bg-white",
            className,
          )}
          disabled={disabled}
          aria-label={ariaLabel}
          title={selectedLabels.join("、") || undefined}
        >
          <span className={cn("min-w-0 flex-1 truncate", selectedLabels.length === 0 && "text-slate-500")}>{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <OptionPopoverContent>
          {searchable ? <div className="mb-2 shrink-0 border-b pb-2">
            <OptionSearch value={query} onChange={setQuery} placeholder={searchPlaceholder} disabled={saving} />
          </div> : null}
          {options.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-slate-500">{emptyMessage}</p>
          ) : filteredOptions.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-slate-500" role="status" aria-live="polite">{copy.common.noSearchResults}</p>
          ) : (
            <div key={query} className="min-h-0 space-y-0.5 overflow-y-auto overscroll-contain p-0.5">
              {filteredOptions.map((option) => {
                const selected = draftSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:py-1.5"
                    onClick={() => toggle(option.value)}
                    disabled={saving}
                  >
                    <span className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent",
                    )}>
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 break-words">{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex shrink-0 justify-end gap-2 border-t pt-2">
            <Button type="button" size="sm" variant="outline" onClick={() => changeOpen(false)} disabled={saving}>
              {cancelLabel}
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !changed}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {saveLabel}
            </Button>
          </div>
        </OptionPopoverContent>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
