"use client";
import { useEffect, useState } from "react";
import { Eye, Plus, RefreshCw, Trash2, Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import { capabilityKeys, skillKeys, type AiSettings, type Endpoint, type SkillKey } from "@/lib/ai/schema";
import { DEFAULT_PROMPTS, defaultSettings } from "@/lib/ai/prompts";
import { aiApi } from "./api";

type PublicEndpoint = Endpoint & { hasApiKey?: boolean };
type ConfigData = { value: AiSettings; version: number };
export function AiSettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<AiSettings>(defaultSettings);
  const [version, setVersion] = useState(0), [tab, setTab] = useState<"models" | "skills">("models");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [showKey, setShowKey] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ label: string; action: () => void } | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setBusy(true); setError(""); setStatus("");
    aiApi<ConfigData>("settings", "GET", undefined, controller.signal).then((data) => { setValue(data.value); setVersion(data.version); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open]);
  function endpointChange(id: string, patch: Partial<Endpoint>) {
    setStatus(""); setValue((s) => ({ ...s, endpoints: s.endpoints.map((e) => e.id === id ? { ...e, ...patch } : e) }));
  }
  function skillChange(id: SkillKey, patch: Partial<AiSettings["skills"][SkillKey]>) {
    setStatus(""); setValue((s) => ({ ...s, skills: { ...s.skills, [id]: { ...s.skills[id], ...patch } } }));
  }
  async function save() {
    setBusy(true); setError(""); setStatus("");
    try {
      const data = await aiApi<ConfigData>("settings", "PUT", { version, value: { ...value, endpoints: value.endpoints.map((endpoint) => {
        const e = { ...endpoint } as PublicEndpoint; delete e.hasApiKey; return e;
      }) } });
      setValue(data.value); setVersion(data.version); setStatus(copy.ai.saved); onSaved();
      return data;
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); return null; }
    finally { setBusy(false); }
  }
  async function endpointAction(endpoint: Endpoint, action: "models" | "test", capability?: typeof capabilityKeys[number]) {
    // A manual test explicitly saves the reviewed configuration before contacting the endpoint.
    const saved = await save(); if (!saved) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const data = await aiApi<{ models?: string[]; status?: string } & ConfigData>("endpoint-action", "POST", { id: endpoint.id, action, model: endpoint.defaultModel, capability });
      if (data.models) endpointChange(endpoint.id, { models: [...new Set([...endpoint.models, ...data.models])].slice(0, 100) });
      else { setValue(data.value); setVersion(data.version); setStatus((capability ? copy.ai[capability] + "：" : "") + (data.status === "SUPPORTED" ? copy.ai.SUPPORTED : copy.ai.FAILED)); onSaved(); }
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={copy.ai.settings} description={copy.ai.configHint}
    className="max-w-5xl" layerClassName="z-[80]" contentClassName="min-h-0 p-0">
    <div className="flex max-h-[calc(100dvh-10rem)] flex-col" onKeyDown={(e) => { if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation(); }}>
      <div className="flex shrink-0 gap-2 border-b px-5 py-3">
        <Button variant={tab === "models" ? "default" : "ghost"} onClick={() => setTab("models")}>{copy.ai.models}</Button>
        <Button variant={tab === "skills" ? "default" : "ghost"} onClick={() => setTab("skills")}>{copy.ai.skills}</Button>
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5" aria-busy={busy}>
        {tab === "models" ? <>
          {value.endpoints.map((e) => <Card key={e.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <CardTitle><CheckboxField checked={value.activeEndpointId === e.id} onChange={() => setValue((s) => ({ ...s, activeEndpointId: e.id }))} disabled={busy}>{e.name}</CheckboxField></CardTitle>
              <Button variant="destructive" size="sm" disabled={busy} aria-label={copy.ai.deleteEndpoint + " " + e.name} onClick={() => setConfirmation({ label: copy.ai.deleteEndpoint + " " + e.name, action: () => setValue((s) => ({ ...s, activeEndpointId: s.activeEndpointId === e.id ? "" : s.activeEndpointId, endpoints: s.endpoints.filter((p) => p.id !== e.id) })) })}><Trash2 className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label htmlFor={"name-" + e.id}>{copy.ai.name}</Label><Input id={"name-" + e.id} value={e.name} onChange={(event) => endpointChange(e.id, { name: event.target.value })} disabled={busy} /></div>
                <div className="space-y-2"><Label htmlFor={"default-" + e.id}>{copy.ai.defaultModel}</Label><Input id={"default-" + e.id} list={"models-" + e.id} value={e.defaultModel} onChange={(event) => endpointChange(e.id, { defaultModel: event.target.value })} disabled={busy} /><datalist id={"models-" + e.id}>{e.models.map((model) => <option key={model} value={model} />)}</datalist></div>
              </div>
              <div className="space-y-2"><Label htmlFor={"key-" + e.id}>{copy.ai.apiKey}</Label><div className="flex gap-2"><Input id={"key-" + e.id} type={showKey === e.id ? "text" : "password"} value={e.apiKey ?? ""} autoComplete="new-password" onChange={(event) => endpointChange(e.id, { apiKey: event.target.value, clearApiKey: false })} disabled={busy} /><Button variant="outline" size="icon" aria-label={copy.ai.showKey} onClick={() => setShowKey(showKey === e.id ? null : e.id)}><Eye className="h-4 w-4" /></Button></div><p className="text-xs text-slate-500">{(e as PublicEndpoint).hasApiKey ? copy.ai.hasKey : copy.ai.noKey} · {copy.ai.keyHint}</p>
                <CheckboxField checked={e.clearApiKey ?? false} onChange={(checked) => endpointChange(e.id, { clearApiKey: checked, apiKey: "" })} disabled={busy}>{copy.ai.clearKey}</CheckboxField>
              </div>
              <div className="space-y-2"><Label htmlFor={"base-" + e.id}>{copy.ai.baseUrl}</Label><Input id={"base-" + e.id} value={e.baseUrl} onChange={(event) => endpointChange(e.id, { baseUrl: event.target.value })} disabled={busy} /><p className="text-xs text-slate-500">{copy.ai.urlHint}</p></div>
              <details className="space-y-3"><summary className="cursor-pointer text-sm text-slate-600">{copy.ai.advanced}</summary>
                <div className="space-y-2"><Label htmlFor={"token-" + e.id}>{copy.ai.tokenParameter}</Label><Select value={e.tokenParameter ?? "max_tokens"} onValueChange={(tokenParameter) => endpointChange(e.id, { tokenParameter: tokenParameter as Endpoint["tokenParameter"] })}><SelectTrigger id={"token-" + e.id}><SelectValue /></SelectTrigger><SelectContent className="z-[90]"><SelectItem value="max_tokens">max_tokens</SelectItem><SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor={"chat-" + e.id}>{copy.ai.chatUrl}</Label><Input id={"chat-" + e.id} value={e.chatUrl} onChange={(event) => endpointChange(e.id, { chatUrl: event.target.value })} disabled={busy} /></div>
                <div className="space-y-2"><Label htmlFor={"list-" + e.id}>{copy.ai.modelsUrl}</Label><Input id={"list-" + e.id} value={e.modelsUrl} onChange={(event) => endpointChange(e.id, { modelsUrl: event.target.value })} disabled={busy} /></div>
              </details>
              <div className="break-all rounded-md border bg-slate-50 p-3 text-xs text-slate-600"><p>{copy.ai.finalChat}：{e.chatUrl || e.baseUrl.replace(/\/+$/, "") + "/chat/completions"}</p><p className="mt-2">{copy.ai.finalModels}：{e.modelsUrl || e.baseUrl.replace(/\/+$/, "") + "/models"}</p></div>
              <ModelList endpoint={e} busy={busy} onChange={(models) => endpointChange(e.id, { models })} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void endpointAction(e, "models")}><RefreshCw className="h-4 w-4" />{copy.ai.fetchModels}</Button>
                {capabilityKeys.map((key) => <Button key={key} variant="outline" disabled={busy || !e.defaultModel} onClick={() => void endpointAction(e, "test", key)}><Zap className="h-4 w-4" />{copy.ai[key]} · {copy.ai[e.capabilities[e.defaultModel]?.[key] ?? "UNKNOWN"]}</Button>)}
              </div>
            </CardContent>
          </Card>)}
          {!value.endpoints.length ? <p className="rounded-lg border border-dashed p-6 text-sm text-slate-600">{copy.ai.unconfigured}</p> : null}
          <Button variant="outline" disabled={busy || value.endpoints.length >= 12} onClick={() => {
            const id = crypto.randomUUID();
            setValue((s) => ({ ...s, activeEndpointId: s.activeEndpointId || id, endpoints: [...s.endpoints, { id, name: copy.ai.endpoint, protocol: "chat-completions", baseUrl: "http://localhost:11434/v1", chatUrl: "", modelsUrl: "", defaultModel: "", models: [], capabilities: {} }] }));
          }}><Plus className="h-4 w-4" />{copy.ai.addEndpoint}</Button>
        </> : skillKeys.map((key) => <Card key={key}><CardHeader><CardTitle>{copy.ai[key]}</CardTitle></CardHeader><CardContent className="space-y-4">
          <CheckboxField checked={value.skills[key].enabled} onChange={(enabled) => skillChange(key, { enabled })}>{copy.ai.enabled}</CheckboxField>
          <div className="space-y-2"><Label htmlFor={"endpoint-" + key}>{copy.ai.endpointOverride}</Label><Select value={value.skills[key].endpointId || "inherit"} onValueChange={(id) => skillChange(key, { endpointId: id === "inherit" ? "" : id, model: "" })}><SelectTrigger id={"endpoint-" + key}><SelectValue /></SelectTrigger><SelectContent className="z-[90]"><SelectItem value="inherit">{copy.ai.endpointOverride}</SelectItem>{value.endpoints.map((e) => <SelectItem value={e.id} key={e.id}>{e.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor={"model-" + key}>{copy.ai.modelOverride}</Label><Input id={"model-" + key} value={value.skills[key].model} disabled={!value.skills[key].endpointId} onChange={(e) => skillChange(key, { model: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor={"prompt-" + key}>{copy.ai.prompt}</Label><Textarea id={"prompt-" + key} rows={6} value={value.skills[key].prompt} onChange={(e) => skillChange(key, { prompt: e.target.value })} /></div>
          <Button variant="outline" onClick={() => setConfirmation({ label: copy.ai.restoreConfirm, action: () => skillChange(key, { prompt: DEFAULT_PROMPTS[key] }) })}>{copy.ai.restore}</Button>
        </CardContent></Card>)}
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {status ? <p role="status" className="text-sm text-emerald-700">{status}</p> : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={onClose}>{copy.ai.cancel}</Button><Button disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.ai.save}</Button></div>
    </div>
    <ConfirmDialog open={Boolean(confirmation)} title={copy.ai.settings} description={confirmation?.label ?? ""} layerClassName="z-[90]"
      onCancel={() => setConfirmation(null)} onConfirm={() => { confirmation?.action(); setConfirmation(null); }} />
  </Dialog>;
}
function ModelList({ endpoint, busy, onChange }: { endpoint: Endpoint; busy: boolean; onChange: (models: string[]) => void }) {
  const [model, setModel] = useState("");
  return <div className="space-y-2"><Label htmlFor={"manual-" + endpoint.id}>{copy.ai.manualModel}</Label><div className="flex gap-2"><Input id={"manual-" + endpoint.id} value={model} maxLength={160} onChange={(e) => setModel(e.target.value)} disabled={busy} /><Button variant="outline" disabled={busy || !model.trim()} onClick={() => { onChange([...new Set([...endpoint.models, model.trim()])].slice(0, 100)); setModel(""); }}>{copy.ai.addModel}</Button></div><div className="flex flex-wrap gap-2">{endpoint.models.map((m) => <Button key={m} size="sm" variant="secondary" disabled={busy} onClick={() => onChange(endpoint.models.filter((v) => v !== m))}>{m} ×</Button>)}</div></div>;
}
