"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnFilterPopover } from "@/components/ui/column-filter-popover";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { evaluateStrategyCode, normalizeStrategyCode, validateStrategyCode, type StrategyCodeStatus } from "@/lib/trade-journal/strategy-code";
import { compileStrategyCodeRegex, MAX_STRATEGY_CODE_REGEX_LENGTH, STRATEGY_CODE_FAIL_REGEX, STRATEGY_CODE_PASS_REGEX } from "@/lib/trade-journal/strategy-code-filter";
import { cn } from "@/lib/utils";
import { acceptedScreenshotTypes, allFilterValue, defaultSortDirections, type Draft, type SortKey, type SortState, type TradeOption } from "./journal-trade-table-model";

export function FilterableHead({
  label,
  filterLabel,
  filterId,
  openFilter,
  setOpenFilter,
  active,
  disabled,
  className,
  children,
}: {
  label: string;
  filterLabel?: string;
  filterId: string;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  active: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableHead className={className}>
      <div className="flex items-center gap-1">
        <span className="truncate">{label}</span>
        <ColumnFilterPopover
          id={filterId}
          openFilter={openFilter}
          setOpenFilter={setOpenFilter}
          active={active}
          label={filterLabel ?? label}
          disabled={disabled}
        >
          {children}
        </ColumnFilterPopover>
      </div>
    </TableHead>
  );
}

export function OptionFilterPanel({
  value,
  options,
  onChange,
  onClear,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.chooseValue}</p>
      <div className="max-h-64 overflow-auto rounded-md border p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100",
              option.value === value && "font-medium text-slate-950",
            )}
            onClick={() => onChange(option.value)}
          >
            <Check className={cn("h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")} />
            <span className="truncate">{option.label}</span>
          </button>
        ))}
      </div>
      <ClearColumnButton onClick={onClear} disabled={value === allFilterValue} />
    </div>
  );
}

export function MultiOptionFilterPanel({
  values,
  allLabel,
  options,
  onChange,
  onClear,
}: {
  values: string[];
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
  onClear: () => void;
}) {
  const selected = new Set(values);

  function toggle(value: string) {
    if (selected.has(value)) {
      onChange(values.filter((current) => current !== value));
      return;
    }

    onChange([...values, value]);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.chooseValue}</p>
      <div className="max-h-64 overflow-auto rounded-md border p-1">
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100",
            values.length === 0 && "font-medium text-slate-950",
          )}
          onClick={onClear}
        >
          <span
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              values.length === 0 ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent",
            )}
          >
            <Check className="h-3 w-3" />
          </span>
          <span className="truncate">{allLabel}</span>
        </button>
        {options.map((option) => {
          const isSelected = selected.has(option.value);

          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100",
                isSelected && "font-medium text-slate-950",
              )}
              onClick={() => toggle(option.value)}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  isSelected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent",
                )}
              >
                <Check className="h-3 w-3" />
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
      <ClearColumnButton onClick={onClear} disabled={values.length === 0} />
    </div>
  );
}

export function DateFilterPanel({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.dateRange}</p>
      <div className="space-y-2">
        <FilterPanelField label={copy.tradeJournals.filters.dateFrom}>
          <DatePicker value={dateFrom} onChange={onDateFromChange} className="h-9 w-full justify-start" />
        </FilterPanelField>
        <FilterPanelField label={copy.tradeJournals.filters.dateTo}>
          <DatePicker value={dateTo} onChange={onDateToChange} className="h-9 w-full justify-start" />
        </FilterPanelField>
      </div>
      <ClearColumnButton onClick={onClear} disabled={dateFrom === "" && dateTo === ""} />
    </div>
  );
}

export function StrategyCodeRegexFilterPanel({
  expression,
  onExpressionChange,
  onClear,
}: {
  expression: string;
  onExpressionChange: (value: string) => void;
  onClear: () => void;
}) {
  const compiled = useMemo(() => compileStrategyCodeRegex(expression), [expression]);
  const hasError = expression.trim() !== "" && compiled.error !== null;
  const errorMessage = compiled.error === "TOO_LONG"
    ? copy.tradeJournals.filters.strategyCodeRegexTooLong
    : copy.tradeJournals.filters.strategyCodeRegexError;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.strategyCodeRegex}</p>
        <p className="mt-1 text-xs text-slate-500">{copy.tradeJournals.filters.strategyCodeRegexHint}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">
          {copy.tradeJournals.filters.strategyCodeQuickFilters}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={expression.trim() === STRATEGY_CODE_FAIL_REGEX ? "secondary" : "outline"}
            className="h-8 px-2 text-xs"
            aria-pressed={expression.trim() === STRATEGY_CODE_FAIL_REGEX}
            onClick={() => onExpressionChange(STRATEGY_CODE_FAIL_REGEX)}
          >
            {copy.tradeJournals.filters.strategyCodeQuickFail}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={expression.trim() === STRATEGY_CODE_PASS_REGEX ? "secondary" : "outline"}
            className="h-8 px-2 text-xs"
            aria-pressed={expression.trim() === STRATEGY_CODE_PASS_REGEX}
            onClick={() => onExpressionChange(STRATEGY_CODE_PASS_REGEX)}
          >
            {copy.tradeJournals.filters.strategyCodeQuickPass}
          </Button>
        </div>
      </div>
      <Input
        value={expression}
        onChange={(event) => onExpressionChange(event.target.value)}
        placeholder={copy.tradeJournals.filters.strategyCodeRegexPlaceholder}
        maxLength={MAX_STRATEGY_CODE_REGEX_LENGTH + 1}
        className={cn("h-9 font-mono", hasError && "border-red-300 focus-visible:ring-red-100")}
        aria-invalid={hasError}
      />
      {hasError ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
      <ClearColumnButton onClick={onClear} disabled={expression.trim() === ""} />
    </div>
  );
}

export function FilterPanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function ClearColumnButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onClick} disabled={disabled}>
      <RotateCcw className="h-3.5 w-3.5" />
      {copy.tradeJournals.filters.clearColumn}
    </Button>
  );
}

export function SortableHead({
  label,
  sortKey,
  activeSort,
  onSort,
  className,
  disabled,
  filter,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
  disabled?: boolean;
  filter?: React.ReactNode;
}) {
  const isActive = activeSort.key === sortKey;
  const currentDirection = isActive ? activeSort.direction : null;
  const nextDirection = isActive && activeSort.direction === "asc" ? "desc" : defaultSortDirections[sortKey];
  const Icon = currentDirection === "asc" ? ArrowUp : currentDirection === "desc" ? ArrowDown : ArrowUpDown;
  const title = (nextDirection === "asc" ? copy.tradeJournals.sortAscending : copy.tradeJournals.sortDescending)
    .replace("{field}", label);

  return (
    <TableHead
      className={className}
      aria-sort={currentDirection === "asc" ? "ascending" : currentDirection === "desc" ? "descending" : "none"}
    >
      <div className={cn("flex items-center gap-1", className?.includes("text-right") && "justify-end")}>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
            isActive && "text-slate-950",
          )}
          onClick={() => onSort(sortKey)}
          disabled={disabled}
          aria-label={title}
          title={title}
        >
          <span>{label}</span>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {filter}
      </div>
    </TableHead>
  );
}

export function EditableRow({
  draft,
  setDraft,
  options,
  showStrategyCode,
  onSave,
  onCancel,
  loading,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  options: TradeOption[];
  showStrategyCode: boolean;
  onSave: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const strategyCodeValidation = useMemo(() => validateStrategyCode(draft.strategyCode), [draft.strategyCode]);

  function setField<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <TableRow className="bg-blue-50/50 align-top">
      <TableCell><DatePicker value={draft.date} onChange={(value) => setField("date", value)} /></TableCell>
      <TableCell><OptionSelect value={draft.instrumentOptionId} onChange={(value) => setField("instrumentOptionId", value)} options={options.filter((option) => option.type === "INSTRUMENT")} placeholder={copy.tradeJournals.chooseInstrument} /></TableCell>
      <TableCell><OptionSelect value={draft.strategyOptionId} onChange={(value) => setField("strategyOptionId", value)} options={options.filter((option) => option.type === "STRATEGY")} placeholder={copy.tradeJournals.chooseStrategy} /></TableCell>
      {showStrategyCode ? (
        <TableCell>
          <StrategyCodeInput
            value={draft.strategyCode}
            onChange={(value) => setField("strategyCode", value)}
            onBlur={() => setField("strategyCode", normalizeStrategyCode(draft.strategyCode))}
          />
        </TableCell>
      ) : null}
      <TableCell className="text-slate-400">{copy.common.dash}</TableCell>
      <NumberInput value={draft.entryPrice} onChange={(value) => setField("entryPrice", value)} />
      <NumberInput value={draft.stopLossPrice} onChange={(value) => setField("stopLossPrice", value)} />
      <NumberInput value={draft.riskAmount} onChange={(value) => setField("riskAmount", value)} />
      <NumberInput value={draft.targetPrice} onChange={(value) => setField("targetPrice", value)} />
      <NumberInput value={draft.exitPrice} onChange={(value) => setField("exitPrice", value)} />
      <TableCell className="text-right text-slate-400">{copy.common.dash}</TableCell>
      <TableCell><ScreenshotInput value={draft.screenshot} onChange={(value) => setField("screenshot", value)} /></TableCell>
      <TableCell className="sticky right-0 z-10 min-w-40 border-l bg-blue-50 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
        <div className="flex gap-1">
          <Button type="button" size="sm" onClick={onSave} disabled={loading || !strategyCodeValidation.valid}><Check className="h-4 w-4" />{copy.tradeJournals.save}</Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={loading}><X className="h-4 w-4" />{copy.tradeJournals.cancel}</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function StrategyCodeInput({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const validation = useMemo(() => validateStrategyCode(value), [value]);
  const evaluation = validation.valid ? evaluateStrategyCode(validation.normalized) : null;

  return (
    <div className="w-80 space-y-2">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={copy.tradeJournals.strategyCodePlaceholder}
        className={cn("font-mono uppercase", !validation.valid && "border-red-300 focus-visible:ring-red-100")}
        aria-invalid={!validation.valid}
      />
      <div className="rounded-md border bg-white p-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-slate-500">
            {copy.tradeJournals.strategyCodeNormalized}：
            <span className="ml-1 font-mono text-slate-800">
              {validation.normalized || copy.common.dash}
            </span>
          </span>
          {evaluation ? <StrategyCodeBadge status={evaluation.status} /> : null}
          {evaluation ? (
            <span className="text-slate-600">
              {copy.tradeJournals.strategyCodeBCount}：{evaluation.bCount}
            </span>
          ) : null}
          {evaluation ? (
            <span className="text-slate-600">
              {copy.tradeJournals.strategyCodeCItems}：
              {evaluation.cKeys.length > 0 ? evaluation.cKeys.join("、") : copy.tradeJournals.strategyCodeNone}
            </span>
          ) : null}
        </div>
        {!validation.valid ? <p className="mt-1 text-red-600">{validation.error}</p> : null}
        {evaluation ? <p className="mt-1 text-slate-500">{evaluation.reason}</p> : null}
        {evaluation?.status === "FAIL" ? (
          <p className="mt-1 font-medium text-red-700">{copy.tradeJournals.strategyCodeFailWarning}</p>
        ) : null}
      </div>
    </div>
  );
}

export function StrategyCodeBadge({ status }: { status: StrategyCodeStatus }) {
  const label = status === "PASS"
    ? copy.tradeJournals.strategyCodeStatuses.pass
    : status === "FAIL"
      ? copy.tradeJournals.strategyCodeStatuses.fail
      : copy.tradeJournals.strategyCodeStatuses.unrated;

  return (
    <Badge
      className={cn(
        "shrink-0 px-1.5 py-0",
        status === "PASS" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        status === "FAIL" && "border-red-200 bg-red-50 text-red-700",
        status === "UNRATED" && "border-slate-200 bg-slate-100 text-slate-600",
      )}
    >
      {label}
    </Badge>
  );
}

export function ScreenshotInput({ value, onChange }: { value: File | null; onChange: (value: File | null) => void }) {
  const [pasteError, setPasteError] = useState<string | null>(null);

  function chooseScreenshot(file: File | null) {
    if (!file) {
      onChange(null);
      setPasteError(null);
      return;
    }
    if (!acceptedScreenshotTypes.has(file.type)) {
      setPasteError(copy.tradeJournals.screenshotPasteUnsupported);
      return;
    }
    onChange(file);
    setPasteError(null);
  }

  function pasteScreenshot(clipboardData: DataTransfer) {
    const imageItem = Array.from(clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (!imageItem) return false;
    chooseScreenshot(imageItem.getAsFile());
    return true;
  }

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (event.clipboardData && pasteScreenshot(event.clipboardData)) event.preventDefault();
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  return (
    <div
      className="w-64 space-y-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      aria-label={copy.tradeJournals.screenshotPasteHint}
      onPaste={(event) => {
        if (!pasteScreenshot(event.clipboardData)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="h-8 w-full text-xs"
        onChange={(event) => chooseScreenshot(event.target.files?.[0] ?? null)}
      />
      <p className="text-xs text-slate-500">
        {value
          ? copy.tradeJournals.screenshotSelected.replace("{name}", value.name || copy.tradeJournals.pastedScreenshot)
          : copy.tradeJournals.screenshotPasteHint}
      </p>
      {pasteError ? <p className="text-xs text-red-600">{pasteError}</p> : null}
    </div>
  );
}

export function OptionSelect({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: TradeOption[]; placeholder: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} disabled={!option.active && option.id !== value}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NumberInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <TableCell><Input type="number" min="0.00000001" step="any" value={value} onChange={(event) => onChange(event.target.value)} className="w-28 text-right" /></TableCell>;
}

export function PriceCell({ value }: { value: number | null }) {
  return <TableCell className="text-right font-mono">{value === null ? copy.common.dash : formatNumber(value)}</TableCell>;
}

export function FilteredStat({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

