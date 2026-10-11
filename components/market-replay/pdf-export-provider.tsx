"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import { getAggregationBucket } from "@/lib/market-replay/aggregation";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { planPdfCharts, pdfVolumeCount } from "@/lib/paper-trading/pdf-planner";
import { pdfFilename, replayFilterSearchParams } from "@/lib/paper-trading/pdf-settings";
import { PDF_CHARTS_PER_VOLUME, type PdfChartPage, type PdfChartPreferences, type PdfOptions, type PdfSnapshot, type PdfWindow, type PdfWorkerRequest, type PdfWorkerResponse } from "@/lib/paper-trading/pdf-types";
import type { ReplayJournalFilters } from "@/lib/paper-trading/journal-filters";

const t = copy.paperTrading.pdf;
type StartRequest = { datasetId: string; sessionId: string; filters: ReplayJournalFilters; options: PdfOptions; preferences: PdfChartPreferences };
type Job = { request: StartRequest; snapshot: PdfSnapshot | null; pages: PdfChartPage[] | null; volume: number; controller: AbortController; font: ArrayBuffer | null; url: string | null; filename: string };
type Status = { phase: "reading" | "planning" | "generating" | "ready" | "error" | "complete"; message: string; fatal?: boolean };
const Context = createContext<{ active: boolean; start: (request: StartRequest) => void }>({ active: false, start: () => {} });
export const usePdfExport = () => useContext(Context);

export class PdfExportError extends Error {
  constructor(message: string, public readonly fatal = false) { super(message); }
}
export async function fetchPdfSnapshot(datasetId: string, sessionId: string, filters: ReplayJournalFilters, signal: AbortSignal): Promise<PdfSnapshot> {
  const response = await fetch(`/api/market-datasets/${encodeURIComponent(datasetId)}/paper-journal/sessions/${encodeURIComponent(sessionId)}/export-data?${replayFilterSearchParams(filters)}`, { signal, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new PdfExportError(result.error ?? t.failed, response.status === 404 || response.status === 409);
  return result;
}

function connectWorker(signal: AbortSignal) {
  const worker = new Worker(new URL("../../lib/paper-trading/pdf.worker.ts", import.meta.url));
  let id = 0;
  const pending = new Map<number, { resolve: (response: PdfWorkerResponse) => void; reject: (error: Error) => void }>();
  const fail = (error: Error) => { for (const promise of pending.values()) promise.reject(error); pending.clear(); };
  worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
    const promise = pending.get(event.data.id);
    pending.delete(event.data.id);
    if (event.data.error) promise?.reject(new Error(event.data.error)); else promise?.resolve(event.data);
  };
  worker.onerror = () => fail(new Error(t.failed));
  const abort = () => { worker.terminate(); fail(new DOMException("Aborted", "AbortError")); };
  signal.addEventListener("abort", abort, { once: true });
  return {
    send(request: PdfWorkerRequest, transfer: Transferable[] = []): Promise<PdfWorkerResponse> {
      signal.throwIfAborted();
      const message = { ...request, id: ++id };
      return new Promise((resolve, reject) => {
        pending.set(message.id, { resolve, reject });
        try { worker.postMessage(message, transfer); } catch (error) { pending.delete(message.id); reject(error); }
      });
    },
    close() { signal.removeEventListener("abort", abort); worker.terminate(); fail(new DOMException("Aborted", "AbortError")); },
  };
}

export function PdfExportProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [active, setActive] = useState(false);
  const [background, setBackground] = useState(false);
  const jobRef = useRef<Job | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  function update(job: Job, next: Status) { if (jobRef.current === job) setStatus(next); }
  useEffect(() => {
    const change = () => setBackground(document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => {
      document.removeEventListener("visibilitychange", change);
      const job = jobRef.current; job?.controller.abort();
      if (job?.url) URL.revokeObjectURL(job.url);
    };
  }, []);

  async function run(job: Job) {
    let renderer: ReturnType<typeof import("@/lib/paper-trading/pdf-renderer").createPdfChartRenderer> | null = null;
    let worker: ReturnType<typeof connectWorker> | null = null;
    const signal = job.controller.signal;
    try {
      if (!job.snapshot) {
        update(job, { phase: "reading", message: t.loading });
        const r = job.request;
        job.snapshot = await fetchPdfSnapshot(r.datasetId, r.sessionId, r.filters, signal);
      }
      signal.throwIfAborted();
      const snapshot = job.snapshot;
      const { options, preferences } = job.request;
      if (!snapshot.entries.length) throw new PdfExportError(t.empty, true);
      const sourceSeconds = snapshot.dataset.sourceIntervalSeconds;
      const session = resolveDisplaySession(snapshot.dataset, options.displaySession);
      if (!sourceSeconds || !session || !isValidDisplayInterval(sourceSeconds, options.displayIntervalSeconds))
        throw new PdfExportError(copy.marketReplay.invalidDisplayInterval, true);
      const outside = snapshot.entries.filter((e) => !getAggregationBucket(new Date(e.openedAt).getTime(), sourceSeconds, options.displayIntervalSeconds, session) || !getAggregationBucket(new Date(e.closedAt).getTime(), sourceSeconds, options.displayIntervalSeconds, session));
      if (outside.length) throw new PdfExportError(t.outsideSession(outside.map((e) => "#" + e.no).join("、")), true);
      const read = async (anchor: number, direction: "forward" | "backward", count: number, warmup = 0): Promise<PdfWindow> => {
        signal.throwIfAborted();
        const params = new URLSearchParams({
          anchorSequence: String(anchor), direction, count: String(count), warmupCount: String(warmup),
          displayIntervalSeconds: String(options.displayIntervalSeconds), displaySession: options.displaySession,
          dataVersion: String(snapshot.dataset.dataVersion), endSequence: String(snapshot.endSequence),
        });
        const response = await fetch(`/api/market-datasets/${encodeURIComponent(snapshot.dataset.id)}/bars/export-window?${params}`, { signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new PdfExportError(data.error ?? t.failed, response.status === 404 || response.status === 409);
        return data;
      };
      if (!job.pages) {
        update(job, { phase: "planning", message: t.planning });
        const planned = await planPdfCharts(snapshot.entries, read, (count) => update(job, { phase: "planning", message: t.planned(count) }));
        signal.throwIfAborted(); job.pages = planned;
      }
      const volumes = pdfVolumeCount(job.pages.length);
      const offset = job.volume * PDF_CHARTS_PER_VOLUME;
      const pages = job.pages.slice(offset, offset + PDF_CHARTS_PER_VOLUME);
      const warmup = preferences.emaEnabled ? Math.max(0, ...preferences.emaIndicators.filter((i) => i.visible).map((i) => i.length)) : 0;
      update(job, { phase: "generating", message: t.generating });
      if (!job.font) {
        const response = await fetch("/fonts/NotoSansSC-Regular.ttf", { signal });
        if (!response.ok) throw new Error(t.fontFailed);
        job.font = await response.arrayBuffer();
      }
      signal.throwIfAborted();
      const { createPdfChartRenderer, waitForVisible } = await import("@/lib/paper-trading/pdf-renderer");
      await waitForVisible(signal);
      if (!containerRef.current) throw new Error(t.failed);
      renderer = createPdfChartRenderer(containerRef.current, preferences, snapshot.dataset.priceTickSize, { ...options, session });
      worker = connectWorker(signal);
      const font = job.font.slice(0);
      await worker.send({ id: 0, type: "init", font, metadata: { snapshot, options, preferences, volume: job.volume + 1, volumes, totalCharts: job.pages.length, chartOffset: offset, pages } }, [font]);
      for (let i = 0; i < pages.length; i++) {
        await waitForVisible(signal);
        update(job, { phase: "generating", message: t.progress(offset + i + 1, job.pages.length, job.volume + 1, volumes) });
        const window = await read(pages[i].fromSequence, "forward", pages[i].count, warmup);
        const capture = await renderer.capture(window, pages[i], snapshot.entries, signal);
        await worker.send({ id: 0, type: "chart", page: pages[i], ...capture }, [capture.png]);
      }
      // Recheck the frozen version before publishing this volume.
      await read(pages.at(-1)!.toSequence, "backward", 1);
      const result = await worker.send({ id: 0, type: "finish" });
      signal.throwIfAborted();
      if (!result.pdf) throw new Error(t.failed);
      job.url = URL.createObjectURL(new Blob([result.pdf], { type: "application/pdf" }));
      job.filename = pdfFilename(snapshot.session.name, snapshot.capturedAt, job.volume + 1, volumes);
      update(job, { phase: "ready", message: t.ready(job.volume + 1, volumes) });
    } catch (error) {
      if (!signal.aborted) update(job, { phase: "error", message: error instanceof Error ? error.message : t.failed, fatal: error instanceof PdfExportError && error.fatal });
    } finally { renderer?.remove(); worker?.close(); }
  }

  function start(request: StartRequest) {
    if (jobRef.current) return;
    const job: Job = { request: structuredClone(request), snapshot: null, pages: null, volume: 0, controller: new AbortController(), font: null, url: null, filename: "" };
    jobRef.current = job; setActive(true); void run(job);
  }
  function cancel() {
    const job = jobRef.current; jobRef.current = null;
    job?.controller.abort(); if (job?.url) URL.revokeObjectURL(job.url);
    setActive(false); setStatus(null);
  }
  function download() {
    const job = jobRef.current;
    if (!job?.url || !job.pages) return;
    const link = document.createElement("a"); link.href = job.url; link.download = job.filename;
    document.body.appendChild(link); link.click(); link.remove();
    const url = job.url; job.url = null; setTimeout(() => URL.revokeObjectURL(url), 1000);
    job.volume++;
    if (job.volume < pdfVolumeCount(job.pages.length)) { job.controller = new AbortController(); void run(job); }
    else { jobRef.current = null; setActive(false); setStatus({ phase: "complete", message: t.complete }); }
  }
  const ready = status?.phase === "ready";
  const error = status?.phase === "error";
  return <Context.Provider value={{ active, start }}>
    {children}
    <div ref={containerRef} aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, width: 2400, height: 1200, pointerEvents: "none" }} />
    {status ? <Card className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-3">
        <CardTitle>{t.export}</CardTitle>
        <Button type="button" variant="ghost" size="icon" aria-label={active ? t.cancel : t.dismiss} onClick={cancel}><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="space-y-3 p-3 pt-0">
        <p role={error ? "alert" : "status"} aria-live="polite" className={error ? "max-h-40 overflow-y-auto break-words text-sm text-red-600" : "text-sm text-slate-600"}>
          {!ready && !error && status.phase !== "complete" ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {background && status.phase === "generating" ? t.paused : status.message}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {ready ? <Button type="button" onClick={download}>{jobRef.current && jobRef.current.volume + 1 < pdfVolumeCount(jobRef.current.pages?.length ?? 0) ? t.downloadContinue : t.download}</Button> : null}
          {error && !status.fatal ? <Button type="button" onClick={() => { const job = jobRef.current; if (job) { job.controller = new AbortController(); void run(job); } }}>{t.retry}</Button> : null}
          {active ? <Button type="button" variant="outline" onClick={cancel}>{t.cancel}</Button> : null}
        </div>
      </CardContent>
    </Card> : null}
  </Context.Provider>;
}
