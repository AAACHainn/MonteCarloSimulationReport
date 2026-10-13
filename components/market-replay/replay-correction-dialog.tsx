"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableRow, TableCell, TableHeader, TableHead } from "@/components/ui/table";
import { useReplaySession } from "./replay-session-context";
import { copy } from "@/lib/i18n";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { dateTimeLocalValue, selectedTimeToTimestamp } from "@/lib/market-replay/start-time";
import type { CorrectionJobData, CorrectionMetrics } from "@/lib/replay-sessions/types";

export type CorrectionTarget = { type: "REWIND"; sequence: number } | { type: "DELETE_CYCLE"; cycleKey: string; no: number };
const t = copy.replaySessions;
const terminal = new Set(["APPLIED", "FAILED", "INTERRUPTED", "CANCELLED"]);
export function ReplayCorrectionDialog({ target, timezone, beforeCreate, onClose, onPendingChange }: {
  target: CorrectionTarget | null; timezone: string; beforeCreate: () => Promise<boolean>;
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
  const [timestamp, setTimestamp] = useState("");
  const [sequence, setSequence] = useState<number | null>(null);
  const [bounds, setBounds] = useState<{ minSequence: number; maxSequence: number; minTimestamp: string; maxTimestamp: string } | null>(null);
  const [cycle, setCycle] = useState<{ closed: boolean; entryCount: number; fallbackTargetSequence: number } | null>(null);
  const requestId = useRef("");
  const activeTarget = useRef<CorrectionTarget | null>(target);
  const dismissedJob = useRef<string | null>(null);
  useEffect(() => {
    if (session.pendingCorrectionId && session.pendingCorrectionId !== dismissedJob.current && !jobId) { setJobId(session.pendingCorrectionId); setOpen(true); }
  }, [session.pendingCorrectionId, jobId]);
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    setOpen(true); setError(null); setJob(null); setJobId(null); setBounds(null); setCycle(null);
    requestId.current = crypto.randomUUID(); activeTarget.current = target;
    const query = target.type === "REWIND" ? `/locate?sequence=${target.sequence}` : `/cycles?cycleKey=${encodeURIComponent(target.cycleKey)}`;
    setBusy(true);
    void fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}${query}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t.requestFailed);
      if (target.type === "REWIND") { setBounds(data); setSequence(data.sequence); setTimestamp(dateTimeLocalValue(data.timestamp, timezone)); }
      else setCycle(data);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t.requestFailed); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [target, session.id, timezone]);
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
          setSequence(current.targetSequence);
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
      let targetSequence = selected.type === "REWIND" ? fallback ?? sequence : undefined;
      if (selected.type === "REWIND" && targetSequence === null) {
        const time = selectedTimeToTimestamp(timestamp, timezone);
        if (!Number.isFinite(time)) throw new Error(t.correctionInvalid);
        const response = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}/locate?timestamp=${encodeURIComponent(new Date(time).toISOString())}`);
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t.requestFailed);
        targetSequence = data.sequence; setSequence(data.sequence); setTimestamp(dateTimeLocalValue(data.timestamp, timezone));
      }
      const latestResponse = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}`, { cache: "no-store" });
      const latest = await latestResponse.json(); if (!latestResponse.ok) throw new Error(latest.error ?? t.requestFailed);
      if (latest.session.pendingCorrectionId) { setJobId(latest.session.pendingCorrectionId); onPendingChange(true); return; }
      if (fallback !== undefined || job && terminal.has(job.status)) requestId.current = crypto.randomUUID();
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(session.id)}/corrections`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          requestId: requestId.current || (requestId.current = crypto.randomUUID()), expectedVersion: latest.session.version,
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
        {!jobId && target?.type === "REWIND" ? <>
          <div className="space-y-2"><Label htmlFor="correction-target-time">{t.correctionTarget} · {timezone}</Label><Input id="correction-target-time" type="datetime-local" step="1" value={timestamp}
            min={bounds ? dateTimeLocalValue(bounds.minTimestamp, timezone) : undefined} max={bounds ? dateTimeLocalValue(bounds.maxTimestamp, timezone) : undefined}
            disabled={busy} onChange={(event) => { setTimestamp(event.target.value); setSequence(null); }} /></div>
          <div className="space-y-2"><Label htmlFor="correction-target-sequence">{t.correctionTargetSequence}</Label><Input id="correction-target-sequence" type="number" value={sequence ?? ""} min={bounds?.minSequence} max={bounds?.maxSequence}
            disabled={busy} onChange={(event) => setSequence(event.target.value ? Number(event.target.value) : null)} /></div>
        </> : null}
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
          {(!jobId || job && ["FAILED", "INTERRUPTED"].includes(job.status)) && (target?.type === "REWIND" || cycle?.closed || Boolean(job && activeTarget.current)) ? <Button disabled={busy || !job && target?.type === "REWIND" && !bounds} onClick={() => void create()}>{job ? t.correctionRetry : t.correctionPreview}</Button> : null}
          {(cycle && !cycle.closed || job?.status === "FAILED") && (cycle?.fallbackTargetSequence ?? job?.summary.fallbackTargetSequence) !== undefined ? <Button variant="outline" disabled={busy} onClick={() => void create(cycle?.fallbackTargetSequence ?? job?.summary.fallbackTargetSequence)}>{t.correctionFallback}</Button> : null}
        </div>
      </div>
    </Dialog>
    <ConfirmDialog open={confirm} title={t.correctionApplyTitle} description={t.correctionApplyDescription} confirmLabel={t.correctionApply} isLoading={busy} onCancel={() => setConfirm(false)} onConfirm={() => void action("commit")} />
  </>;
}
