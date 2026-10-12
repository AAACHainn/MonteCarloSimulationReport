"use client";

import { forwardRef, useId, type KeyboardEventHandler } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function filterSelectOptions<T extends { label: string }>(options: T[], query: string): T[] {
  const keywords = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return options;
  return options.filter((option) => {
    const label = normalizeSearch(option.label);
    return keywords.every((keyword) => label.includes(keyword));
  });
}

export const OptionSearch = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}>(({ value, onChange, placeholder, disabled, onKeyDown }, ref) => {
  const id = useId();
  return <div className="relative shrink-0">
    <Label htmlFor={id} className="sr-only">{placeholder}</Label>
    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true" />
    <Input
      ref={ref}
      id={id}
      role="searchbox"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          event.stopPropagation();
          return;
        }
        if (event.key === "Enter") event.preventDefault();
        onKeyDown?.(event);
      }}
      placeholder={placeholder}
      autoComplete="off"
      disabled={disabled}
      className="pl-9 pr-10"
    />
    {value ? <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-1 top-1 h-8 w-8"
      aria-label={copy.common.clearSearch}
      disabled={disabled}
      onClick={(event) => {
        onChange("");
        event.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
    ><X className="h-4 w-4" aria-hidden="true" /></Button> : null}
  </div>;
});
OptionSearch.displayName = "OptionSearch";
