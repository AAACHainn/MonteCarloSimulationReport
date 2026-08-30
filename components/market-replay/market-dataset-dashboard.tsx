"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChartCandlestick, Loader2, Play, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/i18n";
import type { MarketDatasetSummary } from "@/lib/market-replay/types";
import { formatInterval } from "@/lib/market-replay/types";

type ImportIssue = { row: number; reason: string };
type ImportJob = { id: string; fileName: string; status: string; processedRows: number; errors: ImportIssue[]; totalErrors: number };

function formatDatasetTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function MarketDatasetDashboard({ datasets }: { datasets: MarketDatasetSummary[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [totalIssues, setTotalIssues] = useState(0);
  const [deleteDataset, setDeleteDataset] = useState<MarketDatasetSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sessionMode, setSessionMode] = useState<"TWENTY_FOUR_SEVEN" | "DAILY_SESSION">("TWENTY_FOUR_SEVEN");
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);

  async function refreshImportJobs() {
    const response = await fetch("/api/market-dataset-imports");
    if (response.ok) setImportJobs(await response.json());
  }

  useEffect(() => { void refreshImportJobs(); }, []);

  function timeToMinute(value: FormDataEntryValue | null) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  async function importDataset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setIsImporting(true);
    setMessage(null);
    setIssues([]);
    setTotalIssues(0);
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File)) return;
    const sourceIntervalSeconds = Number(formData.get("sourceIntervalSeconds"));
    const metadata = {
      name: formData.get("name"), description: formData.get("description"), symbol: formData.get("symbol"),
      timeframe: formatInterval(sourceIntervalSeconds), timezone: formData.get("timezone"),
      sourceIntervalSeconds, sessionMode,
      sessionOpenMinute: sessionMode === "DAILY_SESSION" ? timeToMinute(formData.get("sessionOpen")) : null,
      sessionCloseMinute: sessionMode === "DAILY_SESSION" ? timeToMinute(formData.get("sessionClose")) : null,
      tradingWeekdays: sessionMode === "DAILY_SESSION" ? formData.getAll("tradingWeekdays").map(Number) : [1,2,3,4,5,6,7],
      fileName: file.name,
    };
    const created = await fetch("/api/market-dataset-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) });
    let data = await created.json().catch(() => null);
    if (!created.ok) {
      setIsImporting(false); setMessage(data?.error ?? copy.marketReplay.importError); return;
    }
    setMessage(copy.marketReplay.uploading);
    const uploaded = await fetch(`/api/market-dataset-imports/${data.id}/file`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
    if (!uploaded.ok) {
      data = await uploaded.json().catch(() => null); setIsImporting(false); setMessage(data?.error ?? copy.marketReplay.importError); return;
    }
    setMessage(copy.marketReplay.processing(0));
    let processingDone = false;
    const processingRequest = fetch(`/api/market-dataset-imports/${data.id}/process`, { method: "POST" }).finally(() => { processingDone = true; });
    while (!processingDone) {
      await new Promise((resolve) => window.setTimeout(resolve, 750));
      if (processingDone) break;
      const progressResponse = await fetch(`/api/market-dataset-imports/${data.id}`);
      const progress = await progressResponse.json().catch(() => null);
      if (progressResponse.ok) setMessage(copy.marketReplay.processing(progress.processedRows ?? 0));
    }
    const response = await processingRequest;
    const result = await response.json().catch(() => null);
    const statusResponse = await fetch(`/api/market-dataset-imports/${data.id}`);
    data = await statusResponse.json().catch(() => result);
    setIsImporting(false);

    if (!response.ok) {
      setMessage(data?.error ?? copy.marketReplay.importError);
      setIssues(data?.errors ?? []); setTotalIssues(data?.totalErrors ?? data?.errors?.length ?? 0);
      await refreshImportJobs();
      return;
    }

    setMessage(copy.marketReplay.imported(data.processedRows));
    form.reset();
    if (fileRef.current) fileRef.current.value = "";
    startTransition(() => router.refresh());
    await refreshImportJobs();
  }

  async function retryImport(job: ImportJob) {
    setIsImporting(true); setMessage(copy.marketReplay.processing(job.processedRows));
    const response = await fetch(`/api/market-dataset-imports/${job.id}/process`, { method: "POST" });
    const data = await response.json().catch(() => null);
    setIsImporting(false);
    if (!response.ok) setMessage(data?.error ?? copy.marketReplay.importError);
    else { setMessage(copy.marketReplay.imported(job.processedRows)); startTransition(() => router.refresh()); }
    await refreshImportJobs();
  }

  async function cancelImport(jobId: string) {
    await fetch(`/api/market-dataset-imports/${jobId}`, { method: "DELETE" });
    await refreshImportJobs();
  }

  async function confirmDelete() {
    if (!deleteDataset) return;
    setIsDeleting(true);
    const response = await fetch(`/api/market-datasets/${deleteDataset.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (!response.ok) {
      setMessage(copy.marketReplay.deleteError);
      setDeleteDataset(null);
      return;
    }
    setDeleteDataset(null);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{copy.marketReplay.importTitle}</CardTitle>
            <CardDescription>{copy.marketReplay.importDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={importDataset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="market-name">{copy.marketReplay.datasetName}</Label>
                <Input id="market-name" name="name" required maxLength={120} placeholder={copy.marketReplay.datasetNamePlaceholder} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="market-description">{copy.marketReplay.description}</Label>
                <Textarea id="market-description" name="description" maxLength={500} placeholder={copy.marketReplay.descriptionPlaceholder} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="market-symbol">{copy.marketReplay.symbol}</Label>
                <Input id="market-symbol" name="symbol" required maxLength={80} placeholder={copy.marketReplay.symbolPlaceholder} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="market-source-interval">{copy.marketReplay.sourceInterval}</Label>
                <Input id="market-source-interval" name="sourceIntervalSeconds" type="number" min="1" max="86400" required defaultValue="1" />
                <p className="text-xs text-slate-500">{copy.marketReplay.sourceIntervalHint}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="market-timezone">{copy.marketReplay.timezone}</Label>
                <Input id="market-timezone" name="timezone" required maxLength={100} defaultValue="Asia/Shanghai" placeholder={copy.marketReplay.timezonePlaceholder} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="market-session-mode">{copy.marketReplay.sessionMode}</Label>
                <select id="market-session-mode" value={sessionMode} onChange={(event) => setSessionMode(event.target.value as typeof sessionMode)} className="h-10 w-full rounded-md border bg-white px-3 text-sm">
                  <option value="TWENTY_FOUR_SEVEN">{copy.marketReplay.session247}</option>
                  <option value="DAILY_SESSION">{copy.marketReplay.sessionDaily}</option>
                </select>
              </div>
              {sessionMode === "DAILY_SESSION" ? (
                <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label htmlFor="session-open">{copy.marketReplay.sessionOpen}</Label><Input id="session-open" name="sessionOpen" type="time" required defaultValue="09:30" /></div>
                    <div><Label htmlFor="session-close">{copy.marketReplay.sessionClose}</Label><Input id="session-close" name="sessionClose" type="time" required defaultValue="16:00" /></div>
                  </div>
                  <div><Label>{copy.marketReplay.tradingWeekdays}</Label><div className="mt-2 flex flex-wrap gap-3">{copy.marketReplay.weekdays.map((label, index) => <label key={label} className="flex items-center gap-1 text-xs"><input type="checkbox" name="tradingWeekdays" value={index + 1} defaultChecked={index < 5} />{label}</label>)}</div></div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="market-file">{copy.marketReplay.csvFile}</Label>
                <Input ref={fileRef} id="market-file" name="file" type="file" accept=".csv,.csv.gz,text/csv,application/gzip" required />
              </div>
              {message ? (
                <Alert className={issues.length ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}>
                  <AlertTitle>{message}</AlertTitle>
                  {issues.length ? (
                    <AlertDescription className="mt-2 space-y-1">
                      {issues.map((issue, index) => <div key={`${issue.row}-${index}`}>{copy.marketReplay.errorRow(issue.row, issue.reason)}</div>)}
                      {totalIssues > issues.length ? <div>{copy.marketReplay.moreErrors(totalIssues - issues.length)}</div> : null}
                    </AlertDescription>
                  ) : null}
                </Alert>
              ) : null}
              {importJobs.length ? <div className="space-y-2 rounded-lg border bg-slate-50 p-3">{importJobs.map((job) => (
                <div key={job.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                  <span className="min-w-0 flex-1 truncate">{job.fileName} · {job.status} · {job.processedRows.toLocaleString("zh-CN")}</span>
                  {["FAILED", "INTERRUPTED", "UPLOADED"].includes(job.status) ? <Button type="button" size="sm" variant="outline" disabled={isImporting} onClick={() => void retryImport(job)}>{copy.marketReplay.retryImport}</Button> : null}
                  {job.status !== "PROCESSING" ? <Button type="button" size="sm" variant="ghost" onClick={() => void cancelImport(job.id)}>{copy.marketReplay.cancelImport}</Button> : null}
                </div>
              ))}</div> : null}
              <Button type="submit" className="w-full" disabled={isImporting || isPending}>
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isImporting ? copy.marketReplay.importing : copy.marketReplay.import}
              </Button>
            </form>
          </CardContent>
        </Card>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{copy.marketReplay.datasetsTitle}</h2>
            <p className="text-sm text-slate-600">{copy.marketReplay.datasetsDescription}</p>
          </div>
          <div className="grid gap-3">
            {datasets.length === 0 ? (
              <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">{copy.marketReplay.empty}</p>
            ) : datasets.map((dataset) => (
              <Card key={dataset.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start gap-3">
                    <ChartCandlestick className="mt-1 h-5 w-5 shrink-0 text-blue-700" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <h3 className="font-semibold text-slate-950">{dataset.name}</h3>
                        <span className="font-mono text-xs text-blue-700">{dataset.symbol} · {dataset.timeframe}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{dataset.description || copy.datasets.noDescription}</p>
                      <dl className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                        <div><dt className="inline font-medium text-slate-700">{copy.marketReplay.dateRange}：</dt><dd className="inline">{formatDatasetTime(dataset.startTime, dataset.timezone)} – {formatDatasetTime(dataset.endTime, dataset.timezone)}</dd></div>
                        <div><dt className="inline font-medium text-slate-700">{copy.marketReplay.recentProgress}：</dt><dd className="inline">{dataset.progress ? copy.marketReplay.progress(Math.max(0, dataset.progress.currentSequence - dataset.progress.startSequence + 1), dataset.barCount - dataset.progress.startSequence) : copy.marketReplay.notStarted}</dd></div>
                      </dl>
                      <p className="mt-2 text-xs text-slate-500">{dataset.barCount.toLocaleString("zh-CN")} {copy.marketReplay.bars} · {dataset.timezone}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button asChild size="sm">
                      <Link href={`/market-replay/${dataset.id}`}><Play className="h-4 w-4" />{copy.marketReplay.open}</Link>
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="text-red-700" onClick={() => setDeleteDataset(dataset)}>
                      <Trash2 className="h-4 w-4" />{copy.marketReplay.delete}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={Boolean(deleteDataset)}
        title={copy.marketReplay.deleteTitle}
        description={copy.marketReplay.deleteConfirm}
        confirmLabel={copy.marketReplay.delete}
        isLoading={isDeleting}
        onCancel={() => setDeleteDataset(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
