"use client";
import { createUuid } from "@/lib/uuid";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableRow, TableCell, TableHeader, TableHead } from "@/components/ui/table";
import { useReplaySession } from "./replay-session-context";
import { copy } from "@/lib/i18n";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { formatUtcDateTime, formatUtcOffset } from "@/lib/market-replay/display-timezone";
import { readChartRewindPoint } from "@/lib/market-replay/chart-rewind";
import type { CorrectionJobData, CorrectionMetrics } from "@/lib/replay-sessions/types";

export type CorrectionTarget = { type: "REWIND"; sequence: number; chartTimestamp?: string } | { type: "DELETE_CYCLE"; cycleKey: string; no: number };
const t = copy.replaySessions;
const terminal = new Set(["APPLIED", "FAILED", "INTERRUPTED", "CANCELLED"]);
export function ReplayCorrectionDialog({ target, displayUtcOffsetMinutes, beforeCreate, onClose, onPendingChange }: {
  target: CorrectionTarget | null; displayUtcOffsetMinutes: number; beforeCreate: () => Promise<boolean>;
  onClose: () => void; onPendingChange: (pending: boolean) => void;
}) {
  const session = useReplaySession()!;
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(session.pendingCorrectionId);
  const [job, setJob] = useState<CorrectionJobData | null>(null);
  const [open, setOpen] = useState(Boolean(session.pendingCorrectionId));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rewindPoint, setRewindPoint] = useState<{ sequence: number; timestamp: string } | null>(null);
  const [cycle, setCycle] = useState<{ closed: boolean; entryCount: number; fallbackTargetSequence: number } | null>(null);
  const requestId = useRef("");
  const activeTarget = useRef<CorrectionTarget | null>(target);
  const beforeCreateRef = useRef(beforeCreate);
  beforeCreateRef.current = beforeCreate;
  const dismissedJob = useRef<string | null>(null);
  useEffect(() => {
    if (session.pendingCorrectionId && session.pendingCorrectionId !== dismissedJob.current && !jobId) { setJobId(session.pendingCorrectionId); setOpen(true); }
  }, [session.pendingCorrectionId, jobId]);
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    setOpen(true); setError(null); setJob(null); setJobId(null); setRewindPoint(null); setCycle(null); setConfirm(false);
    requestId.current = createUuid(); activeTarget.current = target;
    const query = target.type === "REWIND" ? `/locate?sequence=${target.sequence}` : `/cycles?cycleKey=${encodeURIComponent(target.cycleKey)}`;
    setBusy(true);
    void (async () => {
      const readSelection = async () => {
        const response = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}${query}`, { signal: controller.signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t.requestFailed);
        return data;
      };
      if (target.type === "REWIND") {
        const point = await readChartRewindPoint(() => beforeCreateRef.current(), async () => {
          const data = await readSelection(); return { sequence: data.sequence, timestamp: data.timestamp };
        }, controller.signal);
        if (point) setRewindPoint(point);
      } else {
        const data = await readSelection(); if (!controller.signal.aborted) setCycle(data);
      }
    })().catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t.requestFailed); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [target, session.id]);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}/corrections/${encodeURIComponent(jobId!)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t.requestFailed);
        const current = data.job as CorrectionJobData; setJob(current);
        if (!activeTarget.current) {
          activeTarget.current = current.type === "DELETE_CYCLE" && current.cycleKey
            ? { type: "DELETE_CYCLE", cycleKey: current.cycleKey, no: 0 }
            : { type: "REWIND", sequence: current.targetSequence };
        }
        onPendingChange(!terminal.has(current.status));
        if (["QUEUED", "RUNNING"].includes(current.status)) timer = setTimeout(() => void poll(), 1000);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t.requestFailed); }
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [jobId, session.id, onPendingChange]);

  function close() { if (!busy) { setOpen(false); onClose(); } }
  async function create(fallback?: number) {
    const selected = fallback === undefined ? activeTarget.current : { type: "REWIND" as const, sequence: fallback };
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      if (!await beforeCreate()) throw new Error(t.switchFailed);
      const targetSequence = selected.type === "REWIND" ? selected.sequence : undefined;
      const latestResponse = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}`, { cache: "no-store" });
      const latest = await latestResponse.json(); if (!latestResponse.ok) throw new Error(latest.error ?? t.requestFailed);
      if (latest.session.pendingCorrectionId) { setJobId(latest.session.pendingCorrectionId); onPendingChange(true); return; }
      if (fallback !== undefined || job && terminal.has(job.status)) requestId.current = createUuid();
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}/corrections`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          requestId: requestId.current || (requestId.current = createUuid()), expectedVersion: latest.session.version,
          type: selected.type, ...(selected.type === "REWIND" ? { targetSequence } : { cycleKey: selected.cycleKey }),
        }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t.requestFailed);
      setJob(null); setJobId(data.jobId); onPendingChange(true); activeTarget.current = selected;
    } catch (error) { setError(error instanceof Error ? error.message : t.requestFailed); }
    finally { setBusy(false); }
  }
  async function action(kind: "commit" | "cancel") {
    if (!jobId || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}/corrections/${encodeURIComponent(jobId)}/${kind}`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t.requestFailed);
      dismissedJob.current = jobId;
      onPendingChange(false); setOpen(false); setJobId(null); setJob(null); setConfirm(false); onClose(); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : t.requestFailed); setConfirm(false); }
    finally { setBusy(false); }
  }
  const metrics: { label: string; key: Exclude<keyof CorrectionMetrics, "currency">; format: (value: number, currency: string) => string }[] = [
    { label: t.correctionBalance, key: "balance", format: formatMoney }, { label: t.correctionQuantity, key: "netQuantity", format: formatNumber },
    { label: t.correctionFees, key: "totalFees", format: formatMoney }, { label: t.correctionDrawdown, key: "maxDrawdown", format: (value) => formatPercent(value * 100) },
  ];
  return <>
    {!open && jobId && (!job || !terminal.has(job.status)) ? <Button size="sm" variant="outline" className="m-2 self-start" onClick={() => setOpen(true)}>{t.correctionPending}</Button> : null}
    <Dialog open={open} title={t.correction} onClose={close} className="max-w-2xl">
      <div className="space-y-4" aria-busy={busy}>
        {target?.type === "REWIND" || job?.type === "REWIND" ? <p className="text-sm text-slate-600">{t.rewindBoundary}</p> : null}
        {target?.type === "REWIND" ? <div className="space-y-2 rounded-md border bg-slate-50 p-3">
          <p className="text-sm text-slate-600">{target.chartTimestamp ? t.rewindSelectedBar : t.correctionTarget} · {formatUtcOffset(displayUtcOffsetMinutes)}</p>
          {target.chartTimestamp || rewindPoint ? <p className="text-sm font-medium tabular-nums">{formatUtcDateTime(target.chartTimestamp ?? rewindPoint!.timestamp, displayUtcOffsetMinutes)}</p> : null}
          {busy && !rewindPoint && !jobId ? <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t.rewindLoading}</p> : null}
          <p className="text-xs text-slate-600">{t.rewindTargetHint}</p>
        </div> : null}
        {!jobId && target?.type === "DELETE_CYCLE" && cycle ? <p className="text-sm">{cycle.closed ? t.correctionCycleDescription(target.no, cycle.entryCount) : t.correctionOpenCycle}</p> : null}
        {job ? <>
          <p role="status" className="text-sm font-medium">{t.correctionStatuses[job.status]}</p>
          {job.status === "RUNNING" || job.status === "QUEUED" ? <p className="flex items-center gap-2 text-sm tabular-nums"><Loader2 className="h-4 w-4 animate-spin" />{t.correctionSourceProgress(job.processedSourceBars, job.totalSourceBars)}</p> : null}
          {job.status === "READY" ? <>
            {job.summary.originalSequence !== undefined ? <p className="text-sm tabular-nums">{t.correctionPosition(job.summary.originalSequence, job.targetSequence)}</p> : null}
            <Table><TableHeader><TableRow><TableHead /><TableHead className="text-right">{t.correctionBefore}</TableHead><TableHead className="text-right">{t.correctionAfter}</TableHead></TableRow></TableHeader><TableBody>
              {metrics.map((metric) => <TableRow key={metric.key}><TableCell>{metric.label}</TableCell><TableCell className="text-right tabular-nums">{job.summary.before ? metric.format(job.summary.before[metric.key], job.summary.before.currency) : t.correctionNoAccount}</TableCell><TableCell className="text-right tabular-nums">{job.summary.after ? metric.format(job.summary.after[metric.key], job.summary.after.currency) : t.correctionNoAccount}</TableCell></TableRow>)}
              <TableRow><TableCell>{t.correctionEntryCount}</TableCell><TableCell className="text-right tabular-nums">{job.summary.beforeEntries ?? 0}</TableCell><TableCell className="text-right tabular-nums">{job.summary.afterEntries ?? 0}</TableCell></TableRow>
            </TableBody></Table>
            <p className="text-xs text-slate-600">{t.correctionRemovedCommands(job.summary.removedCommands ?? 0)}</p>
          </> : null}
        </> : null}
        {error || job?.error ? <Alert className="border-red-200 bg-red-50" role="alert"><AlertDescription>{error ?? job?.error}</AlertDescription></Alert> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          {jobId && job && !terminal.has(job.status) ? <Button variant="outline" disabled={busy} onClick={() => void action("cancel")}>{t.correctionCancel}</Button> : <Button variant="outline" disabled={busy} onClick={close}>{copy.common.cancel}</Button>}
          {job?.status === "READY" ? <Button disabled={busy} onClick={() => setConfirm(true)}>{t.correctionApply}</Button> : null}
          {(!jobId || job && ["FAILED", "INTERRUPTED"].includes(job.status)) && (target?.type === "REWIND" || cycle?.closed || Boolean(job && activeTarget.current)) ? <Button disabled={busy || !job && target?.type === "REWIND" && !rewindPoint} onClick={() => void create()}>{job ? t.correctionRetry : t.correctionPreview}</Button> : null}
          {(cycle && !cycle.closed || job?.status === "FAILED") && (cycle?.fallbackTargetSequence ?? job?.summary.fallbackTargetSequence) !== undefined ? <Button variant="outline" disabled={busy} onClick={() => void create(cycle?.fallbackTargetSequence ?? job?.summary.fallbackTargetSequence)}>{t.correctionFallback}</Button> : null}
        </div>
      </div>
    </Dialog>
    <ConfirmDialog open={confirm} title={t.correctionApplyTitle} description={t.correctionApplyDescription} confirmLabel={t.correctionApply} isLoading={busy} onCancel={() => setConfirm(false)} onConfirm={() => void action("commit")} />
  </>;
}
