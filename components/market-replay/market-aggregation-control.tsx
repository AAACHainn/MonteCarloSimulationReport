"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers3, Loader2, Play, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";

type Status = { ready: boolean; generationId: string | null; buildFailed: boolean; job: null | { id: string; status: string; processed: number; total: number; error: string | null } };
export function MarketAggregationControl({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const previousGeneration = useRef<{ datasetId: string; generationId: string | null } | null>(null);
  const running = status?.job && ["QUEUED", "RUNNING"].includes(status.job.status);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/market-datasets/${datasetId}/aggregation`, { cache: "no-store" });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error ?? copy.marketReplay.aggregation.failed);
        if (stopped) return;
        setStatus(next); setError(null);
        if (previousGeneration.current?.datasetId === datasetId && previousGeneration.current.generationId !== next.generationId) router.refresh();
        previousGeneration.current = { datasetId, generationId: next.generationId };
        timer = setTimeout(poll, next.job && ["RUNNING", "QUEUED"].includes(next.job.status) ? 1000 : 15000);
      } catch (failure) {
        if (!stopped) { setError(failure instanceof Error ? failure.message : copy.marketReplay.aggregation.failed); timer = setTimeout(poll, 5000); }
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [datasetId, router, running]);

  async function act(action: "rebuild" | "resume" | "cancel") {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/market-datasets/${datasetId}/aggregation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, jobId: status?.job?.id }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? copy.marketReplay.aggregation.failed);
      setStatus(next); setConfirm(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : copy.marketReplay.aggregation.failed); }
    finally { setBusy(false); }
  }
  const job = status?.job;
  const label = !status ? copy.marketReplay.aggregation.loading : job?.status === "RUNNING" ? copy.marketReplay.aggregation.running
    : job?.status === "QUEUED" ? copy.marketReplay.aggregation.queued
    : job?.status === "FAILED" || status?.buildFailed ? copy.marketReplay.aggregation.failed
    : job?.status === "CANCELLED" ? copy.marketReplay.aggregation.cancelled
    : job?.status === "INTERRUPTED" ? copy.marketReplay.aggregation.interrupted
    : status?.ready ? copy.marketReplay.aggregation.ready : copy.marketReplay.aggregation.pending;
  return <section aria-label={copy.marketReplay.aggregation.title} aria-busy={!status || !!running || busy} className="space-y-2 border-t pt-3 text-xs text-slate-600">
    <p className="flex items-center gap-2" role="status" aria-live="polite">{running ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{label}</p>
    {job && job.status !== "COMPLETED" ? <p className="tabular-nums">{copy.marketReplay.aggregation.progress(formatInteger(job.processed), formatInteger(job.total))}</p> : null}
    {status?.ready && job && job.status !== "COMPLETED" ? <p>{copy.marketReplay.aggregation.ready}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      {running ? <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-0" disabled={busy} onClick={() => void act("cancel")}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}{copy.marketReplay.aggregation.cancel}
      </Button> : <>
        {job && ["FAILED", "CANCELLED", "INTERRUPTED"].includes(job.status) ? <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-0" disabled={busy} onClick={() => void act("resume")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}{copy.marketReplay.aggregation.resume}
        </Button> : null}
        <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-0" disabled={busy || !status} onClick={() => status?.ready ? setConfirm(true) : void act("rebuild")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : status?.ready ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Layers3 className="h-4 w-4" aria-hidden="true" />}{status?.ready ? copy.marketReplay.aggregation.rebuild : copy.marketReplay.aggregation.build}
        </Button>
      </>}
    </div>
    {error || job?.error ? <p role="alert" className="text-red-700">{error ?? job?.error}</p> : null}
    <ConfirmDialog open={confirm} onCancel={() => setConfirm(false)} title={copy.marketReplay.aggregation.rebuildTitle} description={copy.marketReplay.aggregation.rebuildDescription} confirmLabel={copy.marketReplay.aggregation.rebuild} confirmVariant="default" isLoading={busy} error={error} onConfirm={() => void act("rebuild")} />
  </section>;
}
