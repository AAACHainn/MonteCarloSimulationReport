"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import {
  toggleReplayChartVisibility,
  type ReplayChartVisibility,
  type ReplayChartVisibilityTarget,
} from "@/lib/market-replay/chart-visibility";

export function ChartVisibilityMenu({
  value,
  onChange,
  includeOrderLines = false,
}: {
  value: ReplayChartVisibility;
  onChange: (value: ReplayChartVisibility) => void;
  includeOrderLines?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const orderLines = value.orderLines ?? true;
  const anyHidden = !value.drawings || !value.indicators || !value.tradeAnnotations || includeOrderLines && !orderLines;
  const allHidden = !value.drawings && !value.indicators && !value.tradeAnnotations && (!includeOrderLines || !orderLines);

  const items: Array<{
    target: Exclude<ReplayChartVisibilityTarget, "all">;
    visible: boolean;
    hideLabel: string;
    showLabel: string;
  }> = [
    { target: "drawings", visible: value.drawings, hideLabel: copy.marketReplay.hideDrawings, showLabel: copy.marketReplay.showDrawings },
    { target: "indicators", visible: value.indicators, hideLabel: copy.marketReplay.hideIndicators, showLabel: copy.marketReplay.showIndicators },
    { target: "tradeAnnotations", visible: value.tradeAnnotations, hideLabel: copy.marketReplay.hideTradeAnnotations, showLabel: copy.marketReplay.showTradeAnnotations },
  ];
  if (includeOrderLines) items.push({ target: "orderLines", visible: orderLines,
    hideLabel: copy.marketReplay.multiPane.hideOrderLines, showLabel: copy.marketReplay.multiPane.showOrderLines });

  function toggle(target: ReplayChartVisibilityTarget) {
    if (target === "all") onChange({
      ...value, drawings: allHidden, indicators: allHidden, tradeAnnotations: allHidden,
      ...(includeOrderLines ? { orderLines: allHidden } : {}),
    });
    else onChange(toggleReplayChartVisibility({ ...value, ...(includeOrderLines ? { orderLines } : {}) }, target));
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant={anyHidden ? "secondary" : "ghost"}
          size="icon"
          className="h-8 w-9 gap-0.5"
          aria-label={copy.marketReplay.chartVisibility}
          aria-pressed={anyHidden}
          title={copy.marketReplay.chartVisibilityHint}
        >
          {anyHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-[80] w-48 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-card p-1.5 shadow-xl"
          role="menu"
          aria-label={copy.marketReplay.chartVisibility}
        >
          {items.map((item) => (
            <button
              key={item.target}
              type="button"
              role="menuitemcheckbox"
              aria-checked={!item.visible}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-slate-700 dark:text-secondary-text hover:bg-slate-100 dark:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() => toggle(item.target)}
            >
              {item.visible ? <EyeOff className="h-4 w-4 text-slate-500 dark:text-muted-foreground" /> : <Eye className="h-4 w-4 text-blue-600 dark:text-link" />}
              <span>{item.visible ? item.hideLabel : item.showLabel}</span>
            </button>
          ))}
          <div className="my-1 border-t border-slate-200 dark:border-border" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={allHidden}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-800 dark:text-foreground hover:bg-slate-100 dark:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            onClick={() => toggle("all")}
          >
            {allHidden ? <Eye className="h-4 w-4 text-blue-600 dark:text-link" /> : <EyeOff className="h-4 w-4 text-slate-500 dark:text-muted-foreground" />}
            <span>{allHidden ? copy.marketReplay.showAll : copy.marketReplay.hideAll}</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
