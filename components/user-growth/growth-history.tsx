"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { copy } from "@/lib/i18n";
import type { GrowthRecord, GrowthRecordPage } from "@/lib/user-growth/types";
import { GrowthRecordsDialog } from "./growth-records-dialog";
const t = copy.userGrowth;
export function GrowthHistory({ userId, onClose, onSource }: { userId: string; onClose: () => void; onSource: (record: GrowthRecord) => void }) {
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const snapshot = useRef<number | undefined>(undefined);
  const [data, setData] = useState<GrowthRecordPage>({ items: [], page: 1, pageSize: 20, total: 0 });
  const [state, setState] = useState<"loading" | "error" | "normal">("loading"), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setState("loading"); setError("");
    const query = new URLSearchParams({ page: String(page), ...(snapshot.current !== undefined ? { snapshot: String(snapshot.current) } : {}) });
    void fetch(`/api/users/${encodeURIComponent(userId)}/growth-records?${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.failedRecords);
      if (!controller.signal.aborted) { snapshot.current = result.snapshot; setData(result); setState("normal"); }
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : t.failedRecords); setState("error"); } });
    return () => controller.abort();
  }, [page, revision, userId]);
  return <GrowthRecordsDialog records={data} state={state} error={error} onRetry={() => setRevision(value => value + 1)} onPageChange={setPage} onClose={onClose} onSource={onSource} />;
}
export function GrowthSourceDialog({ record, onClose }: { record: GrowthRecord; onClose: () => void }) {
  return <Dialog open title={t.realSourceTitle} description={t.realSourceHint} onClose={onClose}>
    <div className="space-y-4 text-sm"><h3 className="font-semibold">{record.title}</h3><p>{record.detail}</p><p>{record.source}</p>
      <p className="tabular-nums">{t.settlementTime}：{record.settledAt}</p><p className="tabular-nums">{t.replayTime}：{record.replayAt}</p>
      {record.ruleVersion && <p className="text-xs text-slate-600">{t.ruleVersion(record.ruleVersion)}</p>}
      {record.deleted ? <p>{t.deleted}</p> : record.sourceUrl ? <div className="flex justify-end border-t pt-4"><Button asChild variant="outline"><Link href={record.sourceUrl}>{t.openRecordedSource}</Link></Button></div> : null}
    </div>
  </Dialog>;
}
