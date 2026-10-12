"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { filterSelectOptions, OptionSearch } from "@/components/ui/option-search";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = { value: string; label: string; disabled?: boolean };

export function SearchableSelect({
  value, options, onValueChange, placeholder, selectedLabel, searchPlaceholder,
  ariaLabel, disabled = false, busy = false, className,
}: {
  value: string;
  options: SearchableSelectOption[];
  onValueChange: (value: string) => void;
  placeholder: string;
  selectedLabel?: string;
  searchPlaceholder: string;
  ariaLabel: string;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filteredOptions = useMemo(() => filterSelectOptions(options, query), [options, query]);
  const label = selectedLabel ?? options.find((option) => option.value === value)?.label ?? placeholder;

  function changeOpen(nextOpen: boolean) {
    if (disabled && nextOpen) return;
    setQuery("");
    setOpen(nextOpen);
  }

  function choose(option: SearchableSelectOption) {
    if (disabled || option.disabled) return;
    changeOpen(false);
    onValueChange(option.value);
  }

  function enabledOptions() {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[role='option']:not(:disabled)") ?? []);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const buttons = enabledOptions();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      (event.key === "ArrowDown" ? buttons[0] : buttons[buttons.length - 1])?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = query.trim() ? undefined : buttons.find((button) => button.value === value);
      (selected ?? buttons[0])?.click();
    }
  }

  function onOptionsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const buttons = enabledOptions();
    const index = buttons.findIndex((button) => button === event.target);
    if (index < 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) searchRef.current?.focus(); else buttons[index - 1]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? buttons[0] : buttons[buttons.length - 1])?.focus();
    }
  }

  return <PopoverPrimitive.Root open={open} onOpenChange={changeOpen}>
    <PopoverPrimitive.Trigger asChild>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-busy={busy}
        disabled={disabled}
        title={label}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            changeOpen(true);
          }
        }}
        className={cn("w-full min-w-0 justify-between px-3 text-left font-normal", className)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      </Button>
    </PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={6}
        align="start"
        collisionPadding={12}
        onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}
        className="z-[200] flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[28rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border bg-white p-2 text-slate-950 shadow-lg"
      >
        <div className="mb-2 shrink-0 border-b pb-2">
          <OptionSearch ref={searchRef} value={query} onChange={setQuery} placeholder={searchPlaceholder} onKeyDown={onSearchKeyDown} />
        </div>
        <div
          key={query}
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onOptionsKeyDown}
          className="min-h-0 space-y-0.5 overflow-y-auto overscroll-contain p-0.5"
        >
          {filteredOptions.length === 0 ? <p className="px-2 py-4 text-center text-sm text-slate-500" role="status" aria-live="polite">{copy.common.noSearchResults}</p> : filteredOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              role="option"
              value={option.value}
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => choose(option)}
              className="h-auto min-h-10 w-full justify-start whitespace-normal rounded-sm px-2 py-2 text-left font-normal focus:bg-slate-100 sm:min-h-8 sm:py-1.5"
            >
              <Check className={cn("h-4 w-4 shrink-0", option.value !== value && "invisible")} aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
            </Button>
          ))}
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}
