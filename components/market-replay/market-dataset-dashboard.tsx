"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
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

type ImportIssue = { row: number; reason: string };

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

  async function importDataset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setIsImporting(true);
    setMessage(null);
    setIssues([]);
    setTotalIssues(0);
    const response = await fetch("/api/market-datasets", { method: "POST", body: new FormData(form) });
    const data = await response.json().catch(() => null);
    setIsImporting(false);

    if (!response.ok) {
      setMessage(data?.error ?? copy.marketReplay.importError);
      setIssues(data?.errors ?? []);
      setTotalIssues(data?.totalErrors ?? data?.errors?.length ?? 0);
      return;
    }

    setMessage(copy.marketReplay.imported(data.imported));
    form.reset();
    if (fileRef.current) fileRef.current.value = "";
    startTransition(() => router.refresh());
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="market-symbol">{copy.marketReplay.symbol}</Label>
                  <Input id="market-symbol" name="symbol" required maxLength={80} placeholder={copy.marketReplay.symbolPlaceholder} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="market-timeframe">{copy.marketReplay.timeframe}</Label>
                  <Input id="market-timeframe" name="timeframe" required maxLength={30} placeholder={copy.marketReplay.timeframePlaceholder} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="market-timezone">{copy.marketReplay.timezone}</Label>
                <Input id="market-timezone" name="timezone" required maxLength={100} defaultValue="Asia/Shanghai" placeholder={copy.marketReplay.timezonePlaceholder} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="market-file">{copy.marketReplay.csvFile}</Label>
                <Input ref={fileRef} id="market-file" name="file" type="file" accept=".csv,text/csv" required />
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
