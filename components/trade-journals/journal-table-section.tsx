"use client";

import { useEffect, useState } from "react";
import { Images, Table2 } from "lucide-react";
import {
  JournalTradeTable,
  type JournalTradeRow,
  type TradeOption,
} from "@/components/trade-journals/journal-trade-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type TableWidth = "standard" | "wide" | "full";
export type JournalViewMode = "table" | "browse";

const storageKey = "trade-journal-table-width";
const widthClasses: Record<TableWidth, string> = {
  standard: "max-w-[1800px]",
  wide: "max-w-[2200px]",
  full: "max-w-none",
};
const widthOptions: Array<{ value: TableWidth; label: string; hint: string }> = [
  {
    value: "standard",
    label: copy.tradeJournals.tableWidthStandard,
    hint: copy.tradeJournals.tableWidthStandardHint,
  },
  {
    value: "wide",
    label: copy.tradeJournals.tableWidthWide,
    hint: copy.tradeJournals.tableWidthWideHint,
  },
  {
    value: "full",
    label: copy.tradeJournals.tableWidthFull,
    hint: copy.tradeJournals.tableWidthFullHint,
  },
];

function isTableWidth(value: string | null): value is TableWidth {
  return value === "standard" || value === "wide" || value === "full";
}

export function JournalTableSection({
  journalId,
  trades,
  options,
}: {
  journalId: string;
  trades: JournalTradeRow[];
  options: TradeOption[];
}) {
  const [tableWidth, setTableWidth] = useState<TableWidth>("wide");
  const [viewMode, setViewMode] = useState<JournalViewMode>("table");
  const [isEditingTrade, setIsEditingTrade] = useState(false);

  useEffect(() => {
    try {
      const savedWidth = window.localStorage.getItem(storageKey);
      if (isTableWidth(savedWidth)) setTableWidth(savedWidth);
    } catch {
      return;
    }
  }, []);

  function changeTableWidth(width: TableWidth) {
    setTableWidth(width);
    try {
      window.localStorage.setItem(storageKey, width);
    } catch {
      return;
    }
  }

  return (
    <section
      className={cn(
        "mx-auto w-full transition-[max-width] duration-300",
        viewMode === "table" ? widthClasses[tableWidth] : "max-w-[1800px]",
      )}
    >
      <Card>
        <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{copy.tradeJournals.statistics}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-md border bg-slate-50 p-1"
              role="group"
              aria-label={copy.tradeJournals.viewMode}
            >
              <Button
                type="button"
                size="sm"
                variant={viewMode === "table" ? "default" : "ghost"}
                className="h-7 rounded px-2.5 text-xs"
                onClick={() => setViewMode("table")}
                disabled={isEditingTrade}
                aria-pressed={viewMode === "table"}
              >
                <Table2 className="h-3.5 w-3.5" />
                {copy.tradeJournals.tableView}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "browse" ? "default" : "ghost"}
                className="h-7 rounded px-2.5 text-xs"
                onClick={() => setViewMode("browse")}
                disabled={isEditingTrade}
                aria-pressed={viewMode === "browse"}
              >
                <Images className="h-3.5 w-3.5" />
                {copy.tradeJournals.browseView}
              </Button>
            </div>
            {viewMode === "table" ? (
              <>
                <span className="text-xs font-medium text-slate-500">{copy.tradeJournals.tableWidth}</span>
                <div
                  className="inline-flex rounded-md border bg-slate-50 p-1"
                  role="group"
                  aria-label={copy.tradeJournals.tableWidth}
                >
                  {widthOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={tableWidth === option.value ? "default" : "ghost"}
                      className="h-7 rounded px-2.5 text-xs"
                      onClick={() => changeTableWidth(option.value)}
                      aria-pressed={tableWidth === option.value}
                      title={option.hint}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-4">
          <JournalTradeTable
            journalId={journalId}
            trades={trades}
            options={options}
            viewMode={viewMode}
            onEditingChange={setIsEditingTrade}
          />
        </CardContent>
      </Card>
    </section>
  );
}
