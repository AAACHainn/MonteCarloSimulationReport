"use client";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Settings, Minus, Plus, Pencil, Trash2, Eraser, Paperclip, Send, Square, Copy, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import Image from "next/image";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatNumber, formatPercent } from "@/lib/format";
import type { AiSettings, SkillKey } from "@/lib/ai/schema";
import type { ContextValue } from "@/lib/ai/context";
import { aiApi } from "./api";
import { AI_SETTINGS_CHANGED_EVENT } from "./settings-events";
import { AiContextPicker, type AttachInput } from "./context-picker";
import { captureContextCharts } from "./capture";

type FixedContext = ContextValue & { id: string };
type Conversation = { id: string; name: string; activeRunId: string | null };
type Message = { id: string; role: string; content: string; contextId: string | null; result: string | null; runId: string | null; reference?: string };
type Run = { id: string; status: string; task: string; contextId: string | null; error: string | null; endpoint: string; model: string; calls: number; completedBatches: number; estimatedChars: number; reference?: string; usage: Array<{ input: number | null; output: number | null }> };
export type AdoptPayload = { entryId: string; projectionId: string; replaySessionId: string; originalDraft: string; draft: string; sourceRunId: string };
type AssistantContext = {
  open: boolean;
  attach: (input: AttachInput) => Promise<void>;
  registerEditor: (handler: ((payload: AdoptPayload) => boolean) | null) => void;
};
const Assistant = createContext<AssistantContext | null>(null);
export const useAiAssistant = () => useContext(Assistant);

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className="min-w-0 break-words text-sm leading-6 [&_code]:break-all [&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-medium [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-slate-50 [&_th]:p-2 [&_ul]:list-disc">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      img: () => null,
      table: ({ children }) => <div className="mb-3 overflow-x-auto"><table>{children}</table></div>,
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{children}</a>,
    }}>{text}</ReactMarkdown>
  </div>;
});
const ContextSources = memo(function ContextSources({ context }: { context: FixedContext }) {
  const [images, setImages] = useState<Array<{ id: string; chartHash: string }>>([]);
  return <details className="text-xs" onToggle={(event) => {
    if (event.currentTarget.open) void aiApi<typeof images>("contexts/" + context.id + "/assets").then(setImages).catch(() => undefined);
  }}>
    <summary className="cursor-pointer text-blue-700">{copy.ai.sources}</summary>
    <div className="space-y-2 pt-2">
      {context.warnings.map((w) => <p key={w}>{w}</p>)}
      {!context.selectedEntryId ? <dl className="grid grid-cols-2 gap-2 rounded-md border p-3 tabular-nums">
        <dt>{copy.ai.closedTrades}</dt><dd>{context.metrics.closedTrades}</dd>
        <dt>{copy.ai.netPnl}</dt><dd>{formatNumber(context.metrics.netPnl)}</dd>
        <dt>{copy.ai.winRate}</dt><dd>{context.metrics.winRatePercent === null ? copy.common.dash : formatPercent(context.metrics.winRatePercent)}</dd>
        <dt>{copy.ai.missingRisk}</dt><dd>{context.metrics.missingRiskTrades}</dd>
      </dl> : null}
      {context.entries.map((entry) => <p key={entry.id}><Link href={entry.href} className="break-all text-blue-700 underline">{entry.sourceId}</Link></p>)}
      {images.map((asset) => <div key={asset.id} className="space-y-1"><Image unoptimized loading="lazy" width={1200} height={600} className="h-auto w-full rounded-md border" src={"/api/ai/assets/" + asset.id} alt={copy.ai.snapshotHint} /><p className="break-all">chart:{asset.chartHash}</p></div>)}
      {!images.length ? context.charts.map((chart) => <p key={chart.hash} className="break-all">{chart.sourceId} · {chart.window.bars[0]?.timestamp}</p>) : null}
    </div>
  </details>;
});
export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false), [pickerOpen, setPickerOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]), [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]), [context, setContext] = useState<FixedContext | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [assets, setAssets] = useState<string[]>([]);
  const [chartImages, setChartImages] = useState(false);
  const [config, setConfig] = useState<AiSettings | null>(null), [task, setTask] = useState<SkillKey>("globalAssistant");
  const [run, setRun] = useState<Run | null>(null), [stream, setStream] = useState<{ chat: string; text: string } | null>(null);
  const [error, setError] = useState(""), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"clear" | "delete" | null>(null), [rename, setRename] = useState<string | null>(null);
  const [reports, setReports] = useState<Array<{ id: string; contextId: string; content: string; createdAt: string }>>([]);
  const [showReports, setShowReports] = useState(false);
  const [staleReports, setStaleReports] = useState<Record<string, boolean>>({});
  const streamAbort = useRef<AbortController | null>(null), captureAbort = useRef<AbortController | null>(null);
  const editor = useRef<((payload: AdoptPayload) => boolean) | null>(null), currentChat = useRef(conversationId);
  const fileInput = useRef<HTMLInputElement>(null), contentRef = useRef<HTMLDivElement>(null);
  currentChat.current = conversationId;
  const registerEditor = useCallback((handler: ((payload: AdoptPayload) => boolean) | null) => { editor.current = handler; }, []);
  const loadConfig = useCallback(async () => {
    try { const data = await aiApi<{ value: AiSettings }>("settings"); setConfig(data.value); } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); }
  }, []);
  useEffect(() => {
    if (!open) return;
    const refresh = () => { void loadConfig(); };
    const storage = (event: StorageEvent) => { if (event.key === AI_SETTINGS_CHANGED_EVENT) refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", storage);
    };
  }, [open, loadConfig]);
  const loadChats = useCallback(async () => {
    const data = await aiApi<Conversation[]>("conversations"); setConversations(data); return data;
  }, []);
  const loadMessages = useCallback(async (id: string, older?: string) => {
    const data = await aiApi<{ conversation: Conversation; messages: Message[] }>("conversations/" + encodeURIComponent(id) + (older ? "?cursor=" + encodeURIComponent(older) : ""));
    if (currentChat.current !== id) return;
    const rows = data.messages.reverse();
    setMessages((s) => older ? [...rows, ...s.filter((m) => !rows.some((r) => r.id === m.id))] : rows);
    setConversations((s) => s.map((c) => c.id === id ? data.conversation : c));
    return data.conversation;
  }, []);
  useEffect(() => {
    if (!open && !conversationId) return;
    void loadConfig();
    void loadChats().then((chats) => { if (!currentChat.current && chats[0]) setConversationId(chats[0].id); }).catch((e) => setError(e.message));
  }, [open, conversationId, loadChats, loadConfig]);
  useEffect(() => {
    setMessages([]); setRun(null); setContext(null); setAssets([]); setChartImages(false); setError(""); setStatus("");
    if (conversationId) void loadMessages(conversationId).catch((e) => setError(e.message));
  }, [conversationId, loadMessages]);
  const activeRunId = conversations.find((c) => c.id === conversationId)?.activeRunId;
  useEffect(() => {
    if (!activeRunId || !conversationId) return;
    let cancelled = false;
    const update = async () => {
      try {
        const data = await aiApi<Run>("runs/" + activeRunId);
        if (cancelled || currentChat.current !== conversationId) return;
        setRun(data);
        if (!["RUNNING", "QUEUED"].includes(data.status)) {
          setStream(null); await loadMessages(conversationId); await loadChats();
          if (data.error) setError(data.error);
        }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : copy.ai.failed); }
    };
    void update(); const timer = setInterval(() => void update(), 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeRunId, conversationId, loadChats, loadMessages]);
  useEffect(() => {
    const node = contentRef.current;
    if (node && node.scrollHeight - node.scrollTop - node.clientHeight < 250) node.scrollTop = node.scrollHeight;
  }, [messages, stream]);
  async function newChat() {
    const chat = await aiApi<Conversation>("conversations", "POST");
    currentChat.current = chat.id; setConversationId(chat.id); await loadChats(); return chat.id;
  }
  async function ensureChat() { return currentChat.current || await newChat(); }
  const attach = useCallback(async (input: AttachInput) => {
    setOpen(true); setError(""); setStatus(""); setBusy(true);
    const controller = new AbortController(); captureAbort.current?.abort(); captureAbort.current = controller;
    try {
      await ensureChat();
      const { images, ...body } = input;
      const fixed = await aiApi<FixedContext>("contexts", "POST", body, controller.signal);
      setContext(fixed); setAssets([]); setChartImages(false); setTask(fixed.selectedEntryId ? "reviewDraft" : "sessionReview");
      if (images) {
        setStatus(copy.ai.capturing);
        await captureContextCharts(fixed, controller.signal);
        setChartImages(true);
      }
      setStatus(copy.ai.contextHint);
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); throw e; }
    finally { setBusy(false); }
    // ensureChat uses the latest chat ref; it is intentionally not a context dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function connectStream(id: string, chatId: string) {
    const controller = new AbortController(); streamAbort.current = controller;
    let text = "", buffer = "", pending = "", flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => { text += pending; pending = ""; if (currentChat.current === chatId) setStream({ chat: chatId, text }); flushTimer = undefined; };
    try {
      const response = await fetch("/api/ai/runs/" + id + "/stream", { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(copy.ai.failed);
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (true) {
        const part = await reader.read(); buffer += decoder.decode(part.value, { stream: !part.done });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "delta") { pending += event.text; if (!flushTimer) flushTimer = setTimeout(flush, 50); }
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "done" && !event.valid && currentChat.current === chatId) setStatus(copy.ai.invalidResult);
        }
        if (part.done) break;
      }
    } catch (e) { if (!controller.signal.aborted && currentChat.current === chatId) setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally {
      if (flushTimer) clearTimeout(flushTimer);
      pending = ""; if (currentChat.current === chatId) { setStream(null); setRun(await aiApi<Run>("runs/" + id)); await loadMessages(chatId); }
      await loadChats();
    }
  }
  async function send() {
    const question = drafts[conversationId]?.trim(); if (!question || busy || activeRunId) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const chatId = await ensureChat();
      const value = await aiApi<{ id: string; task: string }>("runs", "POST", { conversationId: chatId, contextId: context?.id, task, question, assetIds: assets, chartImages, requestId: crypto.randomUUID() });
      setDrafts((s) => ({ ...s, [chatId]: "" })); setAssets([]);
      await loadMessages(chatId); await loadChats();
      if (value.task !== "sessionReview") void connectStream(value.id, chatId);
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally { setBusy(false); }
  }
  async function stop() {
    captureAbort.current?.abort();
    if (activeRunId) await aiApi("runs/" + activeRunId, "DELETE");
    streamAbort.current?.abort(); setStream(null); await loadChats();
  }
  async function close() {
    try {
      const latest = activeRunId ? await aiApi<Run>("runs/" + activeRunId) : run;
      if (latest?.task !== "sessionReview") await stop();
    } finally { setOpen(false); }
  }
  async function upload(files: FileList | File[]) {
    setError("");
    if (files.length + assets.length > 6) { setError(copy.ai.uploadLimit); return; }
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 4 * 1024 * 1024) throw new Error(copy.ai.uploadLimit);
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
        });
        const asset = await aiApi<{ id: string }>("assets", "POST", { dataUrl });
        setAssets((s) => [...s, asset.id]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally { setBusy(false); }
  }
  const endpoint = config?.endpoints.find((e) => e.id === config.activeEndpointId);
  const sendDraft = drafts[conversationId] ?? "";
  const assistantValue = useMemo(() => ({ open, attach, registerEditor }), [open, attach, registerEditor]);
  return <Assistant.Provider value={assistantValue}>
    {children}
    <Button className="fixed bottom-5 right-5 z-[60] h-12 w-12 rounded-lg shadow-lg" size="icon" aria-label={copy.ai.open} onClick={() => setOpen(true)}><Bot className="h-6 w-6" aria-hidden="true" /></Button>
    <Dialog open={open} keepMounted modal={false} movable resizable defaultWidth={800} defaultHeight={720} title={copy.ai.title} description={endpoint ? endpoint.name + " · " + endpoint.defaultModel : copy.ai.unconfigured}
      layerClassName="z-[60]" contentClassName="flex min-h-0 flex-1 flex-col p-0" widthStorageKey="ai-window-width-v1" heightStorageKey="ai-window-height-v1"
      headerActions={<><Button asChild size="icon" variant="ghost"><Link href="/settings/ai" target="_blank" rel="noopener noreferrer" aria-label={copy.ai.openSettings}><Settings className="h-4 w-4" aria-hidden="true" /></Link></Button><Button size="icon" variant="ghost" aria-label={copy.ai.minimize} onClick={() => setOpen(false)}><Minus className="h-4 w-4" aria-hidden="true" /></Button></>}
      onClose={() => void close()}>
      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={(e) => { if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation(); }}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
          <div className="min-w-0 flex-1"><Select value={conversationId || undefined} onValueChange={setConversationId}><SelectTrigger aria-label={copy.ai.title}><SelectValue placeholder={copy.ai.newChat} /></SelectTrigger><SelectContent className="z-[70]">{conversations.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.activeRunId ? " · " + copy.ai.running : ""}</SelectItem>)}</SelectContent></Select></div>
          <Button size="icon" variant="outline" aria-label={copy.ai.newChat} onClick={() => void newChat().catch((e) => setError(e.message))}><Plus className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" aria-label={copy.ai.rename} disabled={!conversationId} onClick={() => setRename(conversations.find((c) => c.id === conversationId)?.name ?? "")}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" aria-label={copy.ai.clear} disabled={!conversationId} onClick={() => setConfirmation("clear")}><Eraser className="h-4 w-4" /></Button>
          <Button size="icon" variant="destructive" aria-label={copy.ai.delete} disabled={!conversationId} onClick={() => setConfirmation("delete")}><Trash2 className="h-4 w-4" /></Button>
        </div>
        {context ? <div className="shrink-0 border-b bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{context.sessionName} · {context.symbol} · {context.template?.name ?? copy.ai.noTemplate}</span><Button size="sm" variant="ghost" onClick={() => { setContext(null); setTask("globalAssistant"); setAssets([]); }}>{copy.ai.removeContext}</Button></div>
          <p>{copy.ai.scope(context.entries.length, context.metrics.reviewedRows)} · {context.display.displayIntervalSeconds}s · {context.timezone} · {context.capturedAt}</p>
          {task === "sessionReview" ? <p className="mt-1">{copy.ai.analysisPlan((context.depth === "full" ? context.charts.length : Math.ceil(context.entries.length / 8)) + 1, context.depth === "full" ? context.charts.length : 0)}</p> : null}
        </div> : null}
        <div ref={contentRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length >= 30 ? <Button variant="ghost" size="sm" onClick={() => void loadMessages(conversationId, messages[0].id)}>{copy.ai.older}</Button> : null}
          {!messages.length && !stream ? <p className="rounded-lg border border-dashed p-6 text-sm text-slate-600">{copy.ai.empty}</p> : null}
          {messages.map((m) => <article key={m.id} className={m.role === "user" ? "rounded-lg border bg-slate-50 p-3" : "min-w-0 space-y-2"}>
            {m.reference ? <p className="break-words text-xs text-slate-500">{m.reference}</p> : null}
            <Markdown text={m.content} />
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(m.content).then(() => setStatus(copy.ai.copied))}><Copy className="h-4 w-4" />{copy.ai.copy}</Button>
              {m.contextId ? <Button variant="ghost" size="sm" onClick={() => void aiApi<FixedContext>("contexts/" + m.contextId).then((c) => { setContext(c); setChartImages(false); }).catch((e) => setError(e.message))}>{copy.ai.sources}</Button> : null}
              {m.result && "draft" in JSON.parse(m.result) ? <Button variant="outline" size="sm" onClick={() => {
                void aiApi<AdoptPayload>("adopt/" + m.id, "POST", {}).then((payload) => {
                  if (!editor.current?.(payload)) throw new Error(copy.ai.applyUnavailable);
                  setStatus(copy.ai.applied); setOpen(false);
                }).catch((e) => setError(e.message));
              }}>{copy.ai.apply}</Button> : null}
              {m.role === "user" ? <Button variant="ghost" size="sm" disabled={Boolean(activeRunId)} onClick={() => {
                if (!m.runId) return;
                setError(""); setStatus("");
                void aiApi<{ id: string; task: string }>("runs/" + m.runId + "/retry", "POST", {}).then(async (value) => {
                  await loadMessages(conversationId); await loadChats();
                  if (value.task !== "sessionReview") void connectStream(value.id, conversationId);
                }).catch((e) => setError(e.message));
              }}>{copy.ai.retry}</Button> : null}
            </div>
          </article>)}
          {stream?.chat === conversationId ? <p className="whitespace-pre-wrap break-words text-sm leading-6" aria-live="off">{stream.text}</p> : null}
          {activeRunId ? <div role="status" className="text-xs text-slate-600"><p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{copy.ai.running} · {run?.completedBatches ?? 0} · {run?.model}</p><p>{run?.reference}</p></div> : null}
          {run ? <p className="text-xs text-slate-500">{run.endpoint} · {run.model} · {run.calls} · {copy.ai.estimated}</p> : null}
          {run?.task === "sessionReview" && ["INTERRUPTED", "FAILED", "CANCELLED", "INVALID_RESULT"].includes(run.status) ? <div className="space-y-2"><p className="text-xs text-slate-500">{copy.ai.continuingHint}</p><Button variant="outline" onClick={() => void aiApi("runs/" + run.id + "/resume", "POST", {}).then(loadChats).catch((e) => setError(e.message))}>{copy.ai.continue}</Button></div> : null}
          {context ? <ContextSources key={context.id} context={context} /> : null}
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
          {status ? <p role="status" className="text-xs text-emerald-700">{status}</p> : null}
        </div>
        <div className="shrink-0 space-y-3 border-t p-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy || Boolean(activeRunId)} onClick={() => setPickerOpen(true)}>{copy.ai.selectContext}</Button>
            <Select value={task} onValueChange={(v) => setTask(v as SkillKey)} disabled={Boolean(activeRunId)}><SelectTrigger className="w-auto min-w-32" aria-label={copy.ai.skills}><SelectValue /></SelectTrigger><SelectContent className="z-[70]">{(["globalAssistant", "chartReading", "reviewDraft", "sessionReview"] as const).map((key) => <SelectItem key={key} value={key}>{copy.ai[key]}</SelectItem>)}</SelectContent></Select>
            <Button variant="ghost" size="sm" onClick={() => { setShowReports(true); void aiApi<typeof reports>("reports").then(setReports).catch((e) => setError(e.message)); }}>{copy.ai.history}</Button>
          </div>
          {context?.charts.length ? <CheckboxField checked={chartImages || context.depth === "full"} disabled={context.depth === "full" || busy || Boolean(activeRunId)} onChange={(checked) => {
            if (!checked) { setChartImages(false); return; }
            const controller = new AbortController(); captureAbort.current = controller; setBusy(true); setStatus(copy.ai.capturing);
            void captureContextCharts(context, controller.signal).then(() => { setChartImages(true); setStatus(""); })
              .catch((e) => setError(e.message)).finally(() => setBusy(false));
          }}>{copy.ai.chartImages(context.charts.length)}</CheckboxField> : null}
          {assets.length ? <div className="flex max-h-24 gap-2 overflow-x-auto">{assets.map((id) => <Button key={id} variant="outline" className="h-auto p-1" aria-label={copy.ai.removeImage} onClick={() => setAssets((s) => s.filter((a) => a !== id))}><Image unoptimized width={96} height={64} className="h-16 max-w-24 object-contain" src={"/api/ai/assets/" + id} alt={copy.ai.imageHint} /></Button>)}</div> : null}
          <Label htmlFor="ai-input" className="sr-only">{copy.ai.title}</Label>
          <Textarea id="ai-input" rows={3} maxLength={8000} value={sendDraft} placeholder={copy.ai.placeholder}
            onChange={(e) => setDrafts((s) => ({ ...s, [conversationId]: e.target.value }))}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void upload(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="icon" variant="outline" aria-label={copy.ai.attachImage} disabled={busy || assets.length >= 6} onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" /></Button>
            <input ref={fileInput} type="file" className="hidden" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
            {activeRunId || busy ? <Button variant="outline" onClick={() => void stop()}><Square className="h-4 w-4" />{copy.ai.stop}</Button> : <Button disabled={!sendDraft.trim() || !endpoint} onClick={() => void send()}><Send className="h-4 w-4" />{copy.ai.send}</Button>}
          </div>
          <p className="text-xs text-slate-500">{copy.ai.contextHint}</p>
        </div>
      </div>
    </Dialog>
    <AiContextPicker open={pickerOpen} initialSessionId={context?.replaySessionId} onClose={() => setPickerOpen(false)} onAttach={attach} />
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation === "clear" ? copy.ai.clear : copy.ai.delete}
      description={confirmation === "clear" ? copy.ai.clearConfirm : copy.ai.deleteConfirm} layerClassName="z-[90]"
      onCancel={() => setConfirmation(null)} onConfirm={() => {
        const action = confirmation, id = conversationId; setConfirmation(null); setBusy(true);
        void aiApi("conversations/" + conversationId + (action === "clear" ? "/clear" : ""), action === "clear" ? "POST" : "DELETE", {})
          .then(async () => { if (currentChat.current === id) { streamAbort.current?.abort(); setMessages([]); setStream(null); if (action === "delete") setConversationId(""); } await loadChats(); }).catch((e) => setError(e.message)).finally(() => setBusy(false));
      }} />
    <Dialog open={rename !== null} title={copy.ai.rename} layerClassName="z-[80]" onClose={() => setRename(null)}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void aiApi("conversations/" + conversationId, "PATCH", { name: rename }).then(() => { setRename(null); return loadChats(); }).catch((e) => setError(e.message)); }}>
        <Label htmlFor="ai-chat-name">{copy.ai.name}</Label><Input id="ai-chat-name" value={rename ?? ""} maxLength={100} onChange={(e) => setRename(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => setRename(null)}>{copy.ai.cancel}</Button><Button disabled={!rename?.trim()}>{copy.ai.save}</Button></div>
      </form>
    </Dialog>
    <Dialog open={showReports} title={copy.ai.history} layerClassName="z-[80]" onClose={() => setShowReports(false)}>
      <div className="space-y-4">{!reports.length ? <p className="text-sm text-slate-600">{copy.ai.noReports}</p> : reports.map((report) => <details key={report.id} className="rounded-lg border p-3" onToggle={(e) => {
        if (e.currentTarget.open) void aiApi<{ stale: boolean }>("reports/" + report.id).then((r) => setStaleReports((s) => ({ ...s, [report.id]: r.stale })));
      }}><summary className="cursor-pointer text-sm">{new Date(report.createdAt).toLocaleString("zh-CN")}</summary>{staleReports[report.id] ? <p className="my-2 text-xs text-amber-800">{copy.ai.sourceChanged}</p> : null}<Markdown text={report.content} /><Button variant="outline" onClick={() => void aiApi<FixedContext>("contexts/" + report.contextId).then((value) => { setContext(value); setChartImages(false); setShowReports(false); setOpen(true); })}>{copy.ai.sources}</Button></details>)}</div>
    </Dialog>
  </Assistant.Provider>;
}
