"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { journalColumnsForContext } from "@/lib/paper-trading/journal-columns";
import { parsePdfDetails, PDF_DETAIL_STORAGE_KEY } from "@/lib/paper-trading/pdf-settings";
import type { ReplayJournalFilters } from "@/lib/paper-trading/journal-filters";
import type { PdfSnapshot, PdfOptions } from "@/lib/paper-trading/pdf-types";
import { displayIntervalOptions } from "@/lib/market-replay/display-interval";
import { formatInterval, isValidDisplayInterval } from "@/lib/market-replay/types";
import { capturePdfChartPreferences } from "./use-replay-preferences";
import { fetchPdfSnapshot, usePdfExport } from "./pdf-export-provider";
import { useReplaySession } from "./replay-session-context";

const t = copy.paperTrading.pdf;
export function PdfExportButton({ datasetId, sessionId, filters, loading, count }: { datasetId: string; sessionId: string; filters: ReplayJournalFilters; loading: boolean; count: number }) {
  const task = usePdfExport();
  const replaySession = useReplaySession();
  const columns = journalColumnsForContext("history", replaySession?.mode);
  const availableFieldIds = columns.filter((column) => column.id !== "no").map((column) => column.id);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PdfSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [options, setOptions] = useState<PdfOptions>({ displayIntervalSeconds: 300, displaySession: "ETH", ...parsePdfDetails(null) });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function close() { controller.current?.abort(); setOpen(false); }
  async function show() {
    if (loading || task.active) return;
    controller.current?.abort();
    const next = new AbortController(); controller.current = next;
    setOpen(true); setReading(true); setError(null); setSnapshot(null);
    try {
      const data = await fetchPdfSnapshot(datasetId, sessionId, structuredClone(filters), next.signal, replaySession?.id, replaySession?.propRoundNumber);
      next.signal.throwIfAborted();
      const source = data.dataset.sourceIntervalSeconds;
      const period = data.entries[0]?.displayIntervalSeconds ?? source ?? 300;
      let details = parsePdfDetails(null);
      try { details = parsePdfDetails(window.localStorage.getItem(PDF_DETAIL_STORAGE_KEY)); } catch { /* storage is optional */ }
      setSnapshot(data);
      setOptions({ ...details, detailFieldIds: details.detailFieldIds.filter((id) => availableFieldIds.includes(id)), displayIntervalSeconds: source && isValidDisplayInterval(source, period) ? period : source ?? 300, displaySession: data.dataset.availableDisplaySessions.includes("RTH") ? "RTH" : "ETH" });
    } catch (cause) { if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : t.failed); }
    finally { if (!next.signal.aborted) setReading(false); }
  }
  const valid = snapshot?.dataset.sourceIntervalSeconds && isValidDisplayInterval(snapshot.dataset.sourceIntervalSeconds, options.displayIntervalSeconds);
  function start() {
    if (!snapshot || !valid || task.active || reading || !snapshot.entries.length) return;
    try { window.localStorage.setItem(PDF_DETAIL_STORAGE_KEY, JSON.stringify({ includeDetails: options.includeDetails, detailFieldIds: options.detailFieldIds })); } catch { /* keep settings for this task */ }
    task.start({ datasetId, sessionId, replaySessionId: replaySession?.id, propRoundNumber: replaySession?.propRoundNumber, filters, options, preferences: capturePdfChartPreferences(snapshot.dataset) }); close();
  }
  return <>
    <Button type="button" variant="outline" size="sm" disabled={loading || task.active || count === 0} title={task.active ? t.active : count === 0 ? t.empty : undefined} onClick={() => void show()}>
      <Download className="h-4 w-4" aria-hidden="true" />{t.export}
    </Button>
    <Dialog open={open} title={t.title} description={t.description} onClose={close}>
      <div className="space-y-4" aria-busy={reading}>
        {reading ? <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p> : null}
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {snapshot ? <>
          <p className="text-sm tabular-nums text-slate-600">{t.counts(snapshot.session.totalCount, snapshot.entries.length)}</p>
          <p className="text-xs text-slate-500">{t.filters}: {snapshot.filterDescription}</p>
          {!snapshot.entries.length ? <p role="status" className="text-sm text-slate-600">{t.empty}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pdf-period">{t.period}</Label>
              <Select value={String(options.displayIntervalSeconds)} onValueChange={(value) => setOptions((o) => ({ ...o, displayIntervalSeconds: Number(value) }))}>
                <SelectTrigger id="pdf-period"><SelectValue /></SelectTrigger>
                <SelectContent>{displayIntervalOptions(snapshot.dataset.sourceIntervalSeconds, options.displayIntervalSeconds).map((s) => <SelectItem key={s} value={String(s)}>{formatInterval(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {snapshot.dataset.availableDisplaySessions.length > 1 ? <div className="space-y-2">
              <Label htmlFor="pdf-session">{t.session}</Label>
              <Select value={options.displaySession} onValueChange={(value) => setOptions((o) => ({ ...o, displaySession: value as "ETH" | "RTH" }))}>
                <SelectTrigger id="pdf-session"><SelectValue /></SelectTrigger>
                <SelectContent>{snapshot.dataset.availableDisplaySessions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div> : null}
          </div>
          <p className="text-xs text-slate-500">{t.context}</p><p className="text-xs text-slate-500">{t.preferenceHint}</p>
          <CheckboxField checked={options.includeDetails} onChange={(value) => setOptions((o) => ({ ...o, includeDetails: value }))}>{t.includeDetails}</CheckboxField>
          {options.includeDetails ? <div className="space-y-3">
            <p className="text-xs text-slate-500">{t.fieldHint}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOptions((o) => ({ ...o, detailFieldIds: [...availableFieldIds] }))}>{t.all}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOptions((o) => ({ ...o, detailFieldIds: [] }))}>{t.clear}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOptions((o) => ({ ...o, includeDetails: true, detailFieldIds: [...availableFieldIds] }))}>{t.reset}</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {columns.map((c) => <CheckboxField key={c.id} checked={c.id === "no" || options.detailFieldIds.includes(c.id)} disabled={c.id === "no"} onChange={(checked) => setOptions((o) => ({ ...o, detailFieldIds: availableFieldIds.filter((id) => id === c.id ? checked : o.detailFieldIds.includes(id)) }))}>{c.label}</CheckboxField>)}
            </div>
          </div> : null}
        </> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={close}>{copy.common.cancel}</Button>
          <Button type="button" disabled={reading || !valid || !snapshot?.entries.length || task.active} onClick={start}>{t.start}</Button>
        </div>
      </div>
    </Dialog>
  </>;
}
