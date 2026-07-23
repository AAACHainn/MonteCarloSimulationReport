"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff, Keyboard } from "lucide-react";
import { ScreenshotPreviewDialog } from "@/components/trade-journals/screenshot-preview-dialog";
import type { JournalTradeRow } from "@/components/trade-journals/journal-trade-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, formatNumber } from "@/lib/format";
import { copy } from "@/lib/i18n";
import {
  getAdjacentBrowseIndex,
  getBrowsableTrades,
  resolveBrowseIndex,
  type BrowseDirection,
} from "@/lib/trade-journal/browse";
import { evaluateStrategyCode, type StrategyCodeStatus } from "@/lib/trade-journal/strategy-code";
import { cn } from "@/lib/utils";

export function JournalTradeBrowser({
  journalId,
  trades,
  currentTradeId,
  onCurrentTradeChange,
}: {
  journalId: string;
  trades: JournalTradeRow[];
  currentTradeId: string | null;
  onCurrentTradeChange: (tradeId: string | null) => void;
}) {
  const browsableTrades = useMemo(() => getBrowsableTrades(trades), [trades]);
  const [previewScreenshot, setPreviewScreenshot] = useState<string | null>(null);
  const currentIndex = resolveBrowseIndex(browsableTrades, currentTradeId);
  const currentTrade = currentIndex >= 0 ? browsableTrades[currentIndex] : null;

  useEffect(() => {
    const nextIndex = resolveBrowseIndex(browsableTrades, currentTradeId);
    const nextTradeId = nextIndex >= 0 ? browsableTrades[nextIndex].id : null;
    if (nextTradeId !== currentTradeId) onCurrentTradeChange(nextTradeId);
  }, [browsableTrades, currentTradeId, onCurrentTradeChange]);

  const move = useCallback((direction: BrowseDirection) => {
    const nextIndex = getAdjacentBrowseIndex(currentIndex, browsableTrades.length, direction);
    if (nextIndex >= 0 && nextIndex !== currentIndex) {
      onCurrentTradeChange(browsableTrades[nextIndex].id);
    }
  }, [browsableTrades, currentIndex, onCurrentTradeChange]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || isTextInputTarget(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        move(-1);
      }
      if (event.key === "ArrowRight" && currentIndex >= 0 && currentIndex < browsableTrades.length - 1) {
        event.preventDefault();
        move(1);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [browsableTrades.length, currentIndex, move]);

  if (!currentTrade) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed bg-slate-50 px-6 py-12 text-center">
        <ImageOff className="h-10 w-10 text-slate-400" />
        <h3 className="mt-4 font-semibold text-slate-950">{copy.tradeJournals.browser.emptyTitle}</h3>
        <p className="mt-2 max-w-lg text-sm text-slate-600">{copy.tradeJournals.browser.emptyDescription}</p>
      </div>
    );
  }

  const screenshotUrl = `/api/trade-journals/${journalId}/trades/${currentTrade.id}/screenshot`;
  const strategyEvaluation = evaluateStrategyCode(currentTrade.strategyCode);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === browsableTrades.length - 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {copy.tradeJournals.browser.tradeInformation}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-950">
              {currentTrade.date || copy.common.dash}
              <span className="mx-2 text-slate-300">/</span>
              {currentTrade.instrumentOption?.name ?? copy.common.dash}
            </p>
          </div>
          <div
            className="rounded-full border bg-white px-3 py-1 font-mono text-sm font-medium text-slate-700"
            aria-live="polite"
          >
            {copy.tradeJournals.browser.counter
              .replace("{current}", String(currentIndex + 1))
              .replace("{total}", String(browsableTrades.length))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <TradeInfo label={copy.tradeJournals.table.date} value={currentTrade.date || copy.common.dash} />
          <TradeInfo
            label={copy.tradeJournals.table.instrument}
            value={currentTrade.instrumentOption?.name ?? copy.common.dash}
          />
          <TradeInfo
            label={copy.tradeJournals.table.strategy}
            value={currentTrade.strategyOption?.name ?? copy.common.dash}
          />
          <TradeInfo
            label={copy.tradeJournals.table.direction}
            value={
              currentTrade.direction === "LONG"
                ? copy.tradeJournals.table.long
                : currentTrade.direction === "SHORT"
                  ? copy.tradeJournals.table.short
                  : copy.common.dash
            }
          />
          <TradeInfo
            label={copy.tradeJournals.table.strategyCode}
            value={
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono" title={currentTrade.strategyCode ?? undefined}>
                  {currentTrade.strategyCode ?? copy.common.dash}
                </span>
                <StrategyStatusBadge status={strategyEvaluation.status} reason={strategyEvaluation.reason} />
              </div>
            }
            className="sm:col-span-2"
          />
          <TradeInfo label={copy.tradeJournals.table.entry} value={formatPrice(currentTrade.entryPrice)} />
          <TradeInfo label={copy.tradeJournals.table.stop} value={formatPrice(currentTrade.stopLossPrice)} />
          <TradeInfo
            label={copy.tradeJournals.table.risk}
            value={currentTrade.riskAmount === null ? copy.common.dash : formatMoney(currentTrade.riskAmount)}
          />
          <TradeInfo label={copy.tradeJournals.table.target} value={formatPrice(currentTrade.targetPrice)} />
          <TradeInfo label={copy.tradeJournals.table.exit} value={formatPrice(currentTrade.exitPrice)} />
          <TradeInfo
            label={copy.tradeJournals.table.r}
            value={`${formatNumber(currentTrade.rMultiple)} R`}
            valueClassName={cn(
              currentTrade.rMultiple > 0 && "text-emerald-700",
              currentTrade.rMultiple < 0 && "text-red-700",
            )}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-slate-950 shadow-sm">
        <button
          type="button"
          className="flex min-h-[320px] w-full items-center justify-center p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:min-h-[480px]"
          onClick={() => setPreviewScreenshot(screenshotUrl)}
          aria-label={copy.tradeJournals.previewScreenshot}
        >
          <Image
            src={screenshotUrl}
            alt={copy.tradeJournals.browser.screenshotAlt
              .replace("{current}", String(currentIndex + 1))
              .replace("{total}", String(browsableTrades.length))}
            width={1800}
            height={1200}
            unoptimized
            priority
            className="max-h-[72vh] w-full object-contain"
          />
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Keyboard className="h-4 w-4" />
          {copy.tradeJournals.browser.keyboardHint}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => move(-1)}
            disabled={isFirst}
            aria-keyshortcuts="ArrowLeft"
          >
            <ChevronLeft className="h-4 w-4" />
            {copy.tradeJournals.browser.previous}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => move(1)}
            disabled={isLast}
            aria-keyshortcuts="ArrowRight"
          >
            {copy.tradeJournals.browser.next}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScreenshotPreviewDialog screenshotUrl={previewScreenshot} onClose={() => setPreviewScreenshot(null)} />
    </div>
  );
}

function TradeInfo({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-white px-3 py-2", className)}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("mt-1 min-w-0 font-mono text-sm font-semibold text-slate-950", valueClassName)}>
        {value}
      </div>
    </div>
  );
}

function StrategyStatusBadge({ status, reason }: { status: StrategyCodeStatus; reason: string }) {
  const label = status === "PASS"
    ? copy.tradeJournals.strategyCodeStatuses.pass
    : status === "FAIL"
      ? copy.tradeJournals.strategyCodeStatuses.fail
      : copy.tradeJournals.strategyCodeStatuses.unrated;

  return (
    <Badge
      title={reason}
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

function formatPrice(value: number | null) {
  return value === null ? copy.common.dash : formatNumber(value);
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
