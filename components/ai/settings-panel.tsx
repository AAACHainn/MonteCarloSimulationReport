"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Eye, Plus, RefreshCw, Trash2, Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import { skillKeys, type AiSettings, type Endpoint, type SkillKey } from "@/lib/ai/schema";
import { DEFAULT_PROMPTS, defaultSettings } from "@/lib/ai/prompts";
import { aiApi } from "./api";
import { notifyAiSettingsChanged } from "./settings-events";

type PublicEndpoint = Endpoint & { hasApiKey?: boolean };
type ConfigData = { value: AiSettings; version: number };
export function AiSettingsPanel() {
  const [value, setValue] = useState<AiSettings>(defaultSettings);
  const [version, setVersion] = useState(0), [tab, setTab] = useState<"models" | "skills">("models");
  const [busy, setBusy] = useState(true), [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const savedConfig = useRef<ConfigData | null>(null);
  const [showKey, setShowKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ label: string; action: () => void } | null>(null);
  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError(""); setStatus("");
    try {
      const data = await aiApi<ConfigData>("settings", "GET", undefined, signal);
      if (signal?.aborted) return;
      savedConfig.current = data; setValue(data.value); setVersion(data.version); setLoaded(true);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);
  function cancelChanges() {
    const saved = savedConfig.current;
    if (!saved) return;
    setValue(saved.value); setVersion(saved.version); setShowKey(null); setError(""); setStatus(copy.ai.changesDiscarded);
  }
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
      savedConfig.current = data; setValue(data.value); setVersion(data.version); setStatus(copy.ai.saved); notifyAiSettingsChanged();
      return data;
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); return null; }
    finally { setBusy(false); }
  }
  async function endpointAction(endpoint: Endpoint, action: "models" | "test") {
    // Explicit endpoint actions save the form before using the configured credentials.
    setPendingAction(endpoint.id + ":" + action);
    const saved = await save(); if (!saved) { setPendingAction(null); return; }
    setBusy(true); setError(""); setStatus("");
    try {
      const data = await aiApi<{ models?: string[]; status?: string; message?: string }>("endpoint-action", "POST", { id: endpoint.id, action, model: endpoint.defaultModel });
      if (data.models) {
        const models = [...new Set(data.models)];
        endpointChange(endpoint.id, { models, defaultModel: models.includes(endpoint.defaultModel) ? endpoint.defaultModel : models[0] ?? "" });
        if (!models.length) setError(copy.ai.noModels);
      } else if (data.status === "CONNECTED") setStatus(copy.ai.connectionSuccess);
      else setError(data.message || copy.ai.connectionFailed);
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally { setBusy(false); setPendingAction(null); }
  }
  return <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b pb-4">
        <Button variant={tab === "models" ? "default" : "ghost"} onClick={() => setTab("models")}>{copy.ai.models}</Button>
        <Button variant={tab === "skills" ? "default" : "ghost"} onClick={() => setTab("skills")}>{copy.ai.skills}</Button>
      </div>
      <p className="text-sm text-slate-600">{copy.ai.configHint}</p>
      <div className="space-y-4" aria-busy={busy}>
        {!loaded ? busy ? <p role="status" className="text-sm text-slate-600">{copy.ai.loadingSettings}</p> : <Button variant="outline" onClick={() => void loadSettings()}>{copy.ai.reloadSettings}</Button> : tab === "models" ? <>
          {value.endpoints.map((e) => <Card key={e.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <CardTitle><CheckboxField checked={value.activeEndpointId === e.id} onChange={() => setValue((s) => ({ ...s, activeEndpointId: e.id }))} disabled={busy}>{e.name}</CheckboxField></CardTitle>
              <Button variant="destructive" size="sm" disabled={busy} aria-label={copy.ai.deleteEndpoint + " " + e.name} onClick={() => setConfirmation({ label: copy.ai.deleteEndpoint + " " + e.name, action: () => setValue((s) => ({ ...s, activeEndpointId: s.activeEndpointId === e.id ? "" : s.activeEndpointId, endpoints: s.endpoints.filter((p) => p.id !== e.id) })) })}><Trash2 className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label htmlFor={"name-" + e.id}>{copy.ai.name}</Label><Input id={"name-" + e.id} value={e.name} onChange={(event) => endpointChange(e.id, { name: event.target.value })} disabled={busy} /></div>
              <div className="space-y-2">
                <Label htmlFor={"key-" + e.id}>{copy.ai.apiKey}</Label>
                <div className="flex gap-2">
                  <Input id={"key-" + e.id} type={showKey === e.id ? "text" : "password"} value={e.apiKey ?? ""} placeholder={(e as PublicEndpoint).hasApiKey && !e.clearApiKey ? copy.ai.savedKeyPlaceholder : undefined} aria-describedby={"key-hint-" + e.id} autoComplete="new-password" onChange={(event) => endpointChange(e.id, { apiKey: event.target.value, clearApiKey: false })} disabled={busy} />
                  <Button variant="outline" size="icon" className="shrink-0" aria-label={copy.ai.showKey} disabled={busy} onClick={() => setShowKey(showKey === e.id ? null : e.id)}><Eye className="h-4 w-4" /></Button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p id={"key-hint-" + e.id} role={e.clearApiKey ? "status" : undefined} className="text-xs text-slate-500">{e.clearApiKey ? copy.ai.keyClearedPending : (e as PublicEndpoint).hasApiKey ? copy.ai.keyHint : copy.ai.noKey}</p>
                  <Button variant="ghost" size="sm" className="h-10 shrink-0 px-2 text-red-600 hover:text-red-700" aria-label={copy.ai.clearKeyLabel} disabled={busy || e.clearApiKey || (!(e as PublicEndpoint).hasApiKey && !e.apiKey)} onClick={() => endpointChange(e.id, { apiKey: "", clearApiKey: Boolean((e as PublicEndpoint).hasApiKey) })}><Eraser className="h-4 w-4" />{copy.ai.clearKey}</Button>
                </div>
              </div>
              <div className="space-y-2"><Label htmlFor={"base-" + e.id}>{copy.ai.baseUrl}</Label><Input id={"base-" + e.id} value={e.baseUrl} onChange={(event) => endpointChange(e.id, { baseUrl: event.target.value })} disabled={busy} /><p className="text-xs text-slate-500">{copy.ai.urlHint}</p></div>
              <details className="space-y-3"><summary className="cursor-pointer text-sm text-slate-600">{copy.ai.advanced}</summary>
                <div className="space-y-2"><Label htmlFor={"token-" + e.id}>{copy.ai.tokenParameter}</Label><Select disabled={busy} value={e.tokenParameter ?? "max_tokens"} onValueChange={(tokenParameter) => endpointChange(e.id, { tokenParameter: tokenParameter as Endpoint["tokenParameter"] })}><SelectTrigger id={"token-" + e.id}><SelectValue /></SelectTrigger><SelectContent className="z-[90]"><SelectItem value="max_tokens">max_tokens</SelectItem><SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor={"chat-" + e.id}>{copy.ai.chatUrl}</Label><Input id={"chat-" + e.id} value={e.chatUrl} onChange={(event) => endpointChange(e.id, { chatUrl: event.target.value })} disabled={busy} /></div>
                <div className="space-y-2"><Label htmlFor={"list-" + e.id}>{copy.ai.modelsUrl}</Label><Input id={"list-" + e.id} value={e.modelsUrl} onChange={(event) => endpointChange(e.id, { modelsUrl: event.target.value })} disabled={busy} /></div>
              </details>
              <div className="break-all rounded-md border bg-slate-50 p-3 text-xs text-slate-600"><p>{copy.ai.finalChat}：{e.chatUrl || e.baseUrl.replace(/\/+$/, "") + "/chat/completions"}</p><p className="mt-2">{copy.ai.finalModels}：{e.modelsUrl || e.baseUrl.replace(/\/+$/, "") + "/models"}</p></div>
              <div className="space-y-2">
                <Label htmlFor={"default-" + e.id}>{copy.ai.defaultModel}</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <Select value={e.defaultModel} disabled={busy || (!e.models.length && !e.defaultModel)} onValueChange={(defaultModel) => endpointChange(e.id, { defaultModel })}>
                    <SelectTrigger id={"default-" + e.id} className="col-span-2 min-w-0 [&>span]:min-w-0 [&>span]:truncate sm:col-span-1"><SelectValue placeholder={copy.ai.selectModel} /></SelectTrigger>
                    <SelectContent className="z-[90] max-w-[calc(100vw-2rem)]">{[...new Set([...(e.defaultModel ? [e.defaultModel] : []), ...e.models])].map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="outline" disabled={busy} onClick={() => void endpointAction(e, "models")}><RefreshCw className={pendingAction === e.id + ":models" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />{copy.ai.fetchModels}</Button>
                  <Button variant="outline" disabled={busy || !e.defaultModel} onClick={() => void endpointAction(e, "test")}>{pendingAction === e.id + ":test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}{copy.ai.testConnection}</Button>
                </div>
              </div>
            </CardContent>
          </Card>)}
          {!value.endpoints.length ? <p className="rounded-lg border border-dashed p-6 text-sm text-slate-600">{copy.ai.unconfigured}</p> : null}
          <Button variant="outline" disabled={busy || value.endpoints.length >= 12} onClick={() => {
            const id = crypto.randomUUID();
            setValue((s) => ({ ...s, activeEndpointId: s.activeEndpointId || id, endpoints: [...s.endpoints, { id, name: copy.ai.endpoint, protocol: "chat-completions", baseUrl: "http://localhost:11434/v1", chatUrl: "", modelsUrl: "", defaultModel: "", models: [], capabilities: {} }] }));
          }}><Plus className="h-4 w-4" />{copy.ai.addEndpoint}</Button>
        </> : skillKeys.map((key) => <Card key={key}><CardHeader><CardTitle>{copy.ai[key]}</CardTitle></CardHeader><CardContent className="space-y-4">
          <CheckboxField disabled={busy} checked={value.skills[key].enabled} onChange={(enabled) => skillChange(key, { enabled })}>{copy.ai.enabled}</CheckboxField>
          <div className="space-y-2"><Label htmlFor={"prompt-" + key}>{copy.ai.prompt}</Label><Textarea disabled={busy} id={"prompt-" + key} rows={6} value={value.skills[key].prompt} onChange={(e) => skillChange(key, { prompt: e.target.value })} /></div>
          <Button disabled={busy} variant="outline" onClick={() => setConfirmation({ label: copy.ai.restoreConfirm, action: () => skillChange(key, { prompt: DEFAULT_PROMPTS[key] }) })}>{copy.ai.restore}</Button>
        </CardContent></Card>)}
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {status ? <p role="status" className="text-sm text-emerald-700">{status}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy || !loaded} onClick={cancelChanges}>{copy.ai.cancel}</Button><Button disabled={busy || !loaded} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.ai.save}</Button></div>
    <ConfirmDialog open={Boolean(confirmation)} title={copy.ai.settings} description={confirmation?.label ?? ""} layerClassName="z-[90]"
      onCancel={() => setConfirmation(null)} onConfirm={() => { confirmation?.action(); setConfirmation(null); }} />
  </div>;
}
