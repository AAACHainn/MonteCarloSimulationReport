"use client";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { aiApi } from "./api";
type Options = {
  sessions: Array<{ id: string; name: string; activeProjectionId: string; dataset: { symbol: string } }>;
  entries: Array<{ id: string; no: number; openedAt: string; review: string }>;
  templates: Array<{ id: string; name: string }>;
};
export type AttachInput = { replaySessionId: string; projectionId: string; entryId?: string; templateId?: string; draft?: string; depth: "quick" | "full"; images: boolean; timeframes?: string[] };
export function AiContextPicker({ open, initialSessionId, onClose, onAttach }: { open: boolean; initialSessionId?: string; onClose: () => void; onAttach: (input: AttachInput) => Promise<void> }) {
  const [options, setOptions] = useState<Options>({ sessions: [], entries: [], templates: [] });
  const [sessionId, setSessionId] = useState(""), [entryId, setEntryId] = useState("all"), [templateId, setTemplateId] = useState("none");
  const [depth, setDepth] = useState<"quick" | "full">("quick"), [images, setImages] = useState(false);
  const [timeframes, setTimeframes] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (open && initialSessionId) setSessionId(initialSessionId); }, [open, initialSessionId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setBusy(true); setError("");
    aiApi<Options>("options?sessionId=" + encodeURIComponent(sessionId), "GET", undefined, controller.signal)
      .then(setOptions).catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, sessionId]);
  const session = options.sessions.find((s) => s.id === sessionId);
  return <Dialog open={open} title={copy.ai.selectContext} onClose={() => { if (!busy) onClose(); }} layerClassName="z-[80]">
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); if (!session || busy) return;
      setBusy(true); setError("");
      void onAttach({ replaySessionId: session.id, projectionId: session.activeProjectionId, entryId: entryId === "all" ? undefined : entryId,
        templateId: templateId === "none" ? undefined : templateId, depth: entryId === "all" ? depth : "quick", images: entryId === "all" ? depth === "full" : images,
        timeframes: timeframes.trim() ? timeframes.split(/[,，\s]+/).filter(Boolean) : undefined })
        .then(onClose).catch((e) => setError(e.message)).finally(() => setBusy(false));
    }}>
      <div className="space-y-2"><Label htmlFor="ai-context-session">{copy.ai.session}</Label><Select value={sessionId} onValueChange={(id) => { setSessionId(id); setEntryId("all"); }} disabled={busy}><SelectTrigger id="ai-context-session"><SelectValue placeholder={copy.ai.session} /></SelectTrigger><SelectContent className="z-[90]">{options.sessions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {s.dataset.symbol}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="ai-context-entry">{copy.ai.trade}</Label><Select value={entryId} onValueChange={setEntryId} disabled={busy}><SelectTrigger id="ai-context-entry"><SelectValue /></SelectTrigger><SelectContent className="z-[90]"><SelectItem value="all">{copy.ai.wholeSession}</SelectItem>{options.entries.map((e) => <SelectItem key={e.id} value={e.id}>#{e.no} · {new Date(e.openedAt).toLocaleString("zh-CN")}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="ai-context-template">{copy.ai.template}</Label><Select value={templateId} onValueChange={setTemplateId} disabled={busy}><SelectTrigger id="ai-context-template"><SelectValue /></SelectTrigger><SelectContent className="z-[90]"><SelectItem value="none">{copy.ai.noTemplate}</SelectItem>{options.templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
      {entryId === "all" ? <div className="space-y-2"><Label htmlFor="ai-depth">{copy.ai.depth}</Label><Select value={depth} onValueChange={(value) => setDepth(value as "quick" | "full")} disabled={busy}><SelectTrigger id="ai-depth"><SelectValue /></SelectTrigger><SelectContent className="z-[90]"><SelectItem value="quick">{copy.ai.quick}</SelectItem><SelectItem value="full">{copy.ai.full}</SelectItem></SelectContent></Select><p className="text-xs text-slate-500">{copy.ai.fullHint}</p></div> : <CheckboxField checked={images} onChange={setImages} disabled={busy}>{copy.ai.attachImage}</CheckboxField>}
      <p className="text-xs text-slate-500">{copy.ai.contextHint}</p>
      <div className="space-y-2"><Label htmlFor="ai-timeframes">{copy.ai.timeframes}</Label><Input id="ai-timeframes" value={timeframes} onChange={(e) => setTimeframes(e.target.value)} disabled={busy} placeholder="5m, 1h" aria-describedby="ai-timeframes-hint" /><p id="ai-timeframes-hint" className="text-xs text-slate-500">{copy.ai.timeframesHint}</p></div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.ai.cancel}</Button><Button disabled={!session || busy}>{busy ? copy.ai.capturing : copy.ai.attach}</Button></div>
    </form>
  </Dialog>;
}
