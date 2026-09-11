import { Loader2 } from "lucide-react";
import { copy } from "@/lib/i18n";

export type ImportIssue = { row: number; reason: string };
export type ImportJob = {
  id: string;
  fileName: string;
  status: string;
  stage: string;
  processedRows: number;
  totalRows: number;
  importedBars: number;
  stageProcessedBytes: number;
  stageTotalBytes: number;
  progressPercent: number;
  estimatedRemainingSeconds: number | null;
  etaScope: "STAGE" | "OVERALL" | null;
  workerRssBytes: number;
  peakWorkerRssBytes: number;
  updatedAt: string;
  errors: ImportIssue[];
  totalErrors: number;
};

function duration(seconds: number) {
  let remaining = Math.max(0, Math.round(seconds));
  const days = Math.floor(remaining / 86_400); remaining %= 86_400;
  const hours = Math.floor(remaining / 3_600); remaining %= 3_600;
  const minutes = Math.floor(remaining / 60);
  const restSeconds = remaining % 60;
  return copy.marketReplay.measurementDuration({ days, hours, minutes, seconds: restSeconds });
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function MarketImportProgress({ job, uploadPercent, children }: {
  job: ImportJob;
  uploadPercent?: number | null;
  children?: React.ReactNode;
}) {
  const stageLabel = copy.marketReplay.importStages[job.stage as keyof typeof copy.marketReplay.importStages]
    ?? copy.marketReplay.importStages.WAITING_UPLOAD;
  const clientUploadProgress = job.stage === "UPLOADING" && uploadPercent !== null && uploadPercent !== undefined
    ? Math.max(job.progressPercent, uploadPercent / 10)
    : job.progressPercent;
  const progress = Math.min(100, Math.max(0, clientUploadProgress));
  const active = ["QUEUED", "PROCESSING"].includes(job.status)
    || (job.status === "CREATED" && job.stage === "UPLOADING");
  const stateLabel = job.status === "INTERRUPTED"
    ? copy.marketReplay.importInterruptedAt(stageLabel)
    : job.status === "FAILED"
      ? copy.marketReplay.importFailedAt(stageLabel)
      : stageLabel;
  const eta = job.estimatedRemainingSeconds === null
    ? active ? copy.marketReplay.importEstimating : copy.common.dash
    : job.etaScope === "OVERALL"
      ? copy.marketReplay.importOverallEta(duration(job.estimatedRemainingSeconds))
      : copy.marketReplay.importStageEta(duration(job.estimatedRemainingSeconds));

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-blue-950">
          {active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
          <span className="truncate">{job.fileName}</span>
        </div>
        <span className="font-mono text-sm font-semibold text-blue-800">{progress.toFixed(1)}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-blue-100"
        role="progressbar"
        aria-label={copy.marketReplay.importProgressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>
      <div className="grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
        <div>{copy.marketReplay.importStageLabel}：<strong>{stateLabel}</strong></div>
        <div>{eta}</div>
        {job.stage === "UPLOADING" ? (
          <div>{copy.marketReplay.importBytes(bytes(job.stageProcessedBytes), bytes(job.stageTotalBytes))}</div>
        ) : null}
        {job.stage === "ANALYZING" ? <div>{copy.marketReplay.importScannedRows(job.processedRows)}</div> : null}
        {["IMPORTING", "FINALIZING", "COMPLETED"].includes(job.stage) ? (
          <>
            <div>{copy.marketReplay.importProcessedRows(job.processedRows, job.totalRows)}</div>
            <div>{copy.marketReplay.importedBarsCount(job.importedBars)}</div>
          </>
        ) : null}
        {job.peakWorkerRssBytes > 0 ? <div>{copy.marketReplay.importPeakMemory(bytes(job.peakWorkerRssBytes))}</div> : null}
        <div>{copy.marketReplay.importLastUpdated(new Date(job.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }))}</div>
      </div>
      {children ? <div className="flex justify-end gap-2">{children}</div> : null}
    </div>
  );
}
