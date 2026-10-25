"use client";

import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import type { GrowthRecord } from "@/lib/user-growth/types";
import { cn } from "@/lib/utils";
import styles from "./user-growth.module.css";

const t = copy.userGrowth;

export function GrowthRecordList({ records, onSource }: { records: GrowthRecord[]; onSource: (record: GrowthRecord) => void }) {
  if (!records.length) return <p className="rounded-md border border-dashed p-6 text-sm leading-6 text-slate-600">{t.recordEmpty}</p>;
  return <ol aria-label={t.recordsList} className={cn(styles.theme, "divide-y")}>
    {records.map((record) => <li key={record.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 border-l border-slate-200 pl-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <strong className="font-medium text-slate-950">{record.title}</strong>
          <span className={cn("font-mono tabular-nums", record.xp ? styles.jade : "text-slate-600")}>{record.xp ? `+${formatInteger(record.xp)}` : t.noXp}</span>
        </div>
        <p className="mt-2 break-words text-sm leading-6 text-slate-600">{record.detail}</p>
        <p className="mt-1 break-words text-xs text-slate-500">{record.source}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pl-4 sm:flex-col sm:items-end sm:justify-start sm:pl-0">
        <time className="font-mono text-xs tabular-nums text-slate-600">{record.settledAt}</time>
        {record.deleted ? <p className="text-sm text-slate-600">{t.deleted}</p> : <Button variant="ghost" className="text-blue-700" onClick={() => onSource(record)}>{t.source}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Button>}
      </div>
    </li>)}
  </ol>;
}
