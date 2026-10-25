"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import type { GrowthRecord, GrowthRecordPage, QueryState } from "@/lib/user-growth/types";
import { GrowthRecordList } from "./growth-record-list";

const t = copy.userGrowth;

/** Receives one page from its controller; never receives or retains the full history. */
export function GrowthRecordsDialog({ records, onPageChange, onSource, onClose, state = "normal", error, onRetry }: {
  state?: QueryState; error?: string; onRetry?: () => void; records: GrowthRecordPage; onPageChange: (page: number) => void; onSource: (record: GrowthRecord) => void; onClose: () => void;
}) {
  const pages = Math.max(1, Math.ceil(records.total / records.pageSize));
  return <Dialog open title={t.historyRecords} description={t.recordsHint} contentClassName="flex flex-col overflow-hidden" onClose={onClose}>
    <div className="flex min-h-0 flex-col gap-4" aria-busy={state === "loading"}>
      {state === "loading" && <p role="status" className="text-sm text-slate-600">{t.loadingRecords}</p>}
      {state === "error" && <div role="alert" className="flex items-center gap-3 text-sm text-red-700">{error ?? t.failedRecords}<Button variant="outline" onClick={onRetry}>{t.retry}</Button></div>}
      <p className="shrink-0 text-sm tabular-nums text-slate-700">{t.recordCount(formatInteger(records.total))} · {t.recordPageSize(formatInteger(records.pageSize))} · {t.settlementTime}</p>
      <div className="min-h-0 overflow-y-auto pr-2">{state !== "normal" && !records.items.length ? null : <GrowthRecordList records={records.items} onSource={onSource} />}</div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p role="status" aria-live="polite" className="text-sm tabular-nums">{t.page(formatInteger(records.page), formatInteger(pages))}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={state !== "normal" || records.page === 1} onClick={() => onPageChange(1)}>{t.first}</Button>
          <Button variant="outline" disabled={state !== "normal" || records.page === 1} onClick={() => onPageChange(records.page - 1)}>{t.previous}</Button>
          <Button variant="outline" disabled={state !== "normal" || records.page >= pages} onClick={() => onPageChange(records.page + 1)}>{t.next}</Button>
          <Button variant="outline" disabled={state !== "normal" || records.page >= pages} onClick={() => onPageChange(pages)}>{t.last}</Button>
        </div>
      </div>
    </div>
  </Dialog>;
}
