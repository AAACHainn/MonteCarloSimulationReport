"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, HelpCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/i18n";
import { compileRExpressionFilter } from "@/lib/trade-journal/r-expression-filter";
import { cn } from "@/lib/utils";

export function ExpressionFilterPopover({
  id,
  label,
  conditionLabel,
  expression,
  openFilter,
  setOpenFilter,
  onExpressionChange,
  onClear,
  disabled,
}: {
  id: string;
  label: string;
  conditionLabel?: string;
  expression: string;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  onExpressionChange: (value: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const isOpen = openFilter === id;
  const active = expression.trim() !== "";
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const compiled = useMemo(() => compileRExpressionFilter(expression), [expression]);
  const hasError = active && compiled.error !== null;

  function updatePanelPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const panelWidth = 288;
    const viewportPadding = 12;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
    setPanelPosition({ left, top: rect.bottom + 6 });
  }

  useEffect(() => {
    if (!isOpen) return;

    updatePanelPosition();

    function handleViewportChange() {
      updatePanelPosition();
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpenFilter((current) => current === id ? null : current);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenFilter((current) => current === id ? null : current);
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [id, isOpen, setOpenFilter]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          (active || isOpen) && "bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800",
        )}
        disabled={disabled}
        aria-label={copy.tradeJournals.filters.openColumnFilter.replace("{field}", label)}
        title={copy.tradeJournals.filters.openColumnFilter.replace("{field}", label)}
        aria-expanded={isOpen}
        onClick={() => {
          updatePanelPosition();
          setOpenFilter((current) => current === id ? null : id);
        }}
      >
        <Filter className="h-3.5 w-3.5" />
      </button>
      {isOpen && panelPosition && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] w-72 rounded-md border bg-white p-3 text-left text-slate-950 shadow-lg"
            style={{ left: panelPosition.left, top: panelPosition.top }}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">{conditionLabel ?? label}</p>
                <div className="group relative">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={copy.tradeJournals.filters.rExpressionHelpTitle}
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                  <div className="pointer-events-none absolute right-0 top-8 z-[160] hidden w-72 rounded-md border bg-white p-3 text-xs leading-5 text-slate-600 shadow-lg group-hover:block group-focus-within:block">
                    <div className="mb-1 font-medium text-slate-950">{copy.tradeJournals.filters.rExpressionHelpTitle}</div>
                    <p>{copy.tradeJournals.filters.rExpressionHelpVariable}</p>
                    <p>{copy.tradeJournals.filters.rExpressionHelpOperators}</p>
                    <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-700">
                      {copy.tradeJournals.filters.rExpressionExamples.map((example) => (
                        <div key={example}>{example}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500">{copy.tradeJournals.filters.rExpression}</span>
                <div className="space-y-1">
                  <Input
                    value={expression}
                    onChange={(event) => onExpressionChange(event.target.value)}
                    placeholder={copy.tradeJournals.filters.rExpressionPlaceholder}
                    className={cn("h-9 font-mono", hasError && "border-red-300 focus-visible:ring-red-100")}
                    aria-invalid={hasError}
                    autoFocus
                  />
                  {hasError ? <p className="text-xs text-red-600">{copy.tradeJournals.filters.rExpressionError}</p> : null}
                </div>
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={onClear}
                disabled={!active}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {copy.tradeJournals.filters.clearColumn}
              </Button>
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
