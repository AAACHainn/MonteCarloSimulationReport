"use client";
import { createUuid } from "@/lib/uuid";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Settings, Minus, Plus, Pencil, Trash2, Eraser, Paperclip, Send, Square, Copy, MoreHorizontal, History, Bot, Layers, ChevronDown, Loader2, MessageSquare, FileText, ChartNoAxesCombined } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { ActionMenu } from "@/components/ui/action-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatNumber, formatPercent, formatInteger } from "@/lib/format";
import type { AiSettings } from "@/lib/ai/schema";
import type { AssistantPlan } from "@/lib/ai/assistant-plan";
import type { ContextValue } from "@/lib/ai/context";
import type { ResponseDetails } from "@/lib/ai/response-details";
import type { ReadEvent } from "@/lib/ai/execution-view";
import { aiApi } from "./api";
import { AiAssistantLauncher } from "./assistant-launcher";
import { AiMarkdown as Markdown, AiMessageCard } from "./assistant-message";
import { AI_SETTINGS_CHANGED_EVENT } from "./settings-events";
import { AiContextPicker, type AttachInput } from "./context-picker";
import { captureContextCharts } from "./capture";
import { useAiPageScope } from "./page-context";
import { AiLimitsFields } from "./limits-fields";
import { resolveLimits, aiLimitsSchema, type AiLimits } from "@/lib/ai/limits";
import type { BudgetView } from "@/lib/ai/budget";
import { useChartCaptures } from "./use-chart-captures";
import { requestedCharts } from "@/lib/ai/chart-images-contract";
import { displayedImageSchema, mergeDisplayedImages, type DisplayedImage } from "@/lib/ai/display-images-contract";

type FixedContext = ContextValue & { id: string };
type Conversation = { id: string; name: string; activeRunId: string | null };
type Message = { id: string; role: string; content: string; contextId: string | null; result: string | null; runId: string | null; reference?: string; createdAt: string; response?: ResponseDetails | null; reads?: ReadEvent[]; budget?: BudgetView; images?: DisplayedImage[] };
type Run = { id: string; status: string; task: string; contextId: string | null; error: string | null; endpoint: string; model: string; completedBatches: number; reference?: string; response?: ResponseDetails | null; reads?: ReadEvent[]; budget?: BudgetView; images?: DisplayedImage[] };
type LiveResponse = { chat: string; runId: string; text: string; reasoning: string; startedAt: string; reasoningMs?: number; response?: ResponseDetails; reads?: ReadEvent[]; images?: DisplayedImage[] };
export type AdoptPayload = { entryId: string; projectionId: string; replaySessionId: string; originalDraft: string; draft: string; sourceRunId: string };
type AssistantContext = {
  open: boolean;
  attach: (input: AttachInput) => Promise<void>;
  registerEditor: (handler: ((payload: AdoptPayload) => boolean) | null) => void;
};
const Assistant = createContext<AssistantContext | null>(null);
export const useAiAssistant = () => useContext(Assistant);

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
      {context.entries.map((entry) => <p key={entry.id}><Link href={entry.href} className="text-blue-700 underline">{copy.ai.tradeNumber(entry.no)}</Link><span className="ml-2 text-slate-500">{new Date(entry.openedAt).toLocaleString("zh-CN")}</span></p>)}
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
  const [fixedMode, setFixedMode] = useState(false);
  const [config, setConfig] = useState<AiSettings | null>(null);
  const [temporaryLimits, setTemporaryLimits] = useState<Record<string, AiLimits | undefined>>({});
  const [limitsDialog, setLimitsDialog] = useState<{ value: AiLimits; target?: Run } | null>(null), [limitsError, setLimitsError] = useState("");
  const effectiveLimits = temporaryLimits[conversationId] ?? resolveLimits(config?.limits);
  const [scopeMode, setScopeMode] = useState<"page" | "pinned" | "none">("page");
  const [clarification, setClarification] = useState("");
  const [sourceContext, setSourceContext] = useState<FixedContext | null>(null), [optionsOpen, setOptionsOpen] = useState(false);
  const pageRegistration = useAiPageScope(), pageScope = pageRegistration?.selection ?? pageRegistration?.page;
  const [run, setRun] = useState<Run | null>(null), [stream, setStream] = useState<LiveResponse | null>(null);
  const [error, setError] = useState(""), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const [loadingChat, setLoadingChat] = useState(true);
  const [confirmation, setConfirmation] = useState<"clear" | "delete" | null>(null), [rename, setRename] = useState<string | null>(null);
  const [reports, setReports] = useState<Array<{ id: string; contextId: string; content: string; createdAt: string }>>([]);
  const [showReports, setShowReports] = useState(false);
  const [staleReports, setStaleReports] = useState<Record<string, boolean>>({});
  const streamAbort = useRef<AbortController | null>(null), captureAbort = useRef<AbortController | null>(null);
  const editor = useRef<((payload: AdoptPayload) => boolean) | null>(null), currentChat = useRef(conversationId);
  const fileInput = useRef<HTMLInputElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const sendLock = useRef(false), loadedChat = useRef("");
  const scrollToLatest = useRef(false);
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
    if (!older && loadedChat.current !== id) scrollToLatest.current = true;
    setMessages((s) => older ? [...rows, ...s.filter((m) => !rows.some((r) => r.id === m.id))] : rows);
    setConversations((s) => s.map((c) => c.id === id ? data.conversation : c));
    if (!older && loadedChat.current !== id) {
      loadedChat.current = id;
      let preference: { mode?: "page" | "pinned" | "none"; contextId?: string } = {};
      try { preference = JSON.parse(localStorage.getItem("ai-chat-scope-v1:" + id) ?? "{}"); } catch { /* Browsing still works without local storage. */ }
      const lastContextId = preference.mode === "pinned" ? preference.contextId : [...rows].reverse().find((m) => m.contextId)?.contextId;
      if (lastContextId) {
        const last = await aiApi<FixedContext>("contexts/" + lastContextId);
        if (currentChat.current === id) { setContext(last); if (preference.mode === "pinned") setScopeMode("pinned"); }
      }
      if (currentChat.current === id && preference.mode === "none") setScopeMode("none");
    }
    if (!older && !data.conversation.activeRunId) {
      const latestRunId = [...rows].reverse().find((message) => message.runId)?.runId;
      if (latestRunId) {
        const latest = await aiApi<Run>("runs/" + latestRunId);
        if (currentChat.current === id) { setRun(latest); if (latest.error) setError(latest.error); }
      }
    }
    return data.conversation;
  }, []);
  useEffect(() => {
    if (!open && !conversationId) return;
    void loadConfig();
    void loadChats().then((chats) => {
      if (!currentChat.current && chats[0]) setConversationId(chats[0].id);
      else if (!currentChat.current) setLoadingChat(false);
    }).catch((e) => { setError(e.message); setLoadingChat(false); });
  }, [open, conversationId, loadChats, loadConfig]);
  useEffect(() => {
    setMessages([]); setRun(null); setContext(null); setAssets([]); setChartImages(false); setError(""); setStatus(""); setClarification(""); setScopeMode("page");
    if (conversationId) {
      setLoadingChat(true);
      void loadMessages(conversationId).catch((e) => setError(e.message)).finally(() => { if (currentChat.current === conversationId) setLoadingChat(false); });
    }
  }, [conversationId, loadMessages]);
  useEffect(() => {
    if (!conversationId || loadedChat.current !== conversationId || loadingChat) return;
    try { localStorage.setItem("ai-chat-scope-v1:" + conversationId, JSON.stringify({ mode: scopeMode, contextId: scopeMode === "pinned" ? context?.id : undefined })); } catch { /* Optional UI preference. */ }
  }, [conversationId, scopeMode, context, loadingChat]);
  const activeRunId = conversations.find((c) => c.id === conversationId)?.activeRunId;
  const capturingRun = useChartCaptures(conversations.flatMap((c) => c.activeRunId ? [c.activeRunId] : []));
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
    if (node && (scrollToLatest.current || node.scrollHeight - node.scrollTop - node.clientHeight < 250)) { node.scrollTop = node.scrollHeight; scrollToLatest.current = false; }
  }, [messages, stream]);
  async function newChat() {
    setLoadingChat(true);
    try {
      const chat = await aiApi<Conversation>("conversations", "POST");
      currentChat.current = chat.id; setConversationId(chat.id); await loadChats(); return chat.id;
    } catch (e) { setLoadingChat(false); throw e; }
  }
  async function ensureChat() { return currentChat.current || await newChat(); }
  const attach = useCallback(async (input: AttachInput) => {
    setOpen(true); setError(""); setStatus(""); setBusy(true);
    const controller = new AbortController(); captureAbort.current?.abort(); captureAbort.current = controller;
    try {
      await ensureChat();
      const { images, ...body } = input;
      const options = await aiApi<{ sessions: Array<{ id: string; dataset: { id: string; startTime: string; timezone: string } }> }>("options?sessionId=" + encodeURIComponent(input.replaySessionId), "GET", undefined, controller.signal);
      const dataset = options.sessions.find((s) => s.id === input.replaySessionId)?.dataset;
      const { capturePdfChartPreferences } = await import("@/components/market-replay/use-replay-preferences");
      const fixed = await aiApi<FixedContext>("contexts", "POST", { ...body, chartAccess: true, ...(dataset ? { chartPreferences: capturePdfChartPreferences(dataset) } : {}) }, controller.signal);
      setContext(fixed); setAssets([]); setChartImages(false); setScopeMode("pinned"); setClarification("");
      if (images) {
        setStatus(copy.ai.capturing);
        await captureContextCharts(fixed, controller.signal);
        setChartImages(true);
      }
      setStatus("");
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); throw e; }
    finally { setBusy(false); }
    // ensureChat uses the latest chat ref; it is intentionally not a context dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function connectStream(id: string, chatId: string) {
    const controller = new AbortController(); streamAbort.current = controller;
    let value: LiveResponse = { chat: chatId, runId: id, text: "", reasoning: "", startedAt: new Date().toISOString() };
    let buffer = "", pending = "", pendingReasoning = "", flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const reasoning = value.reasoning + pendingReasoning;
      value = { ...value, text: value.text + pending, reasoning,
        reasoningMs: value.reasoningMs ?? (pending && reasoning ? Math.max(0, Date.now() - Date.parse(value.startedAt)) : undefined) };
      pending = ""; pendingReasoning = "";
      if (currentChat.current === chatId) setStream(value);
      flushTimer = undefined;
    };
    if (currentChat.current === chatId) setStream(value);
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
          if (event.type === "model_step_start") { pending = ""; pendingReasoning = ""; value = { ...value, text: "", reasoning: "", reasoningMs: undefined, response: undefined }; }
          if (event.type === "images_updated") {
            const images = displayedImageSchema.array().max(12).safeParse(event.images);
            if (images.success) {
              value = { ...value, images: mergeDisplayedImages(value.images ?? [], images.data) };
              if (currentChat.current === chatId) setStream(value);
            }
          }
          if (["tool_started", "tool_completed", "tool_failed"].includes(event.type)) {
            value = { ...value, reads: [...(value.reads ?? []).filter((r) => r.toolCallId !== event.toolCallId), { ...event, status: event.type === "tool_completed" ? "COMPLETED" : event.type === "tool_failed" ? "FAILED" : "RUNNING" }] };
            if (currentChat.current === chatId) setStream(value);
          }
          if (event.type === "response-start") value = { ...value, startedAt: event.startedAt };
          if (event.type === "delta" || event.type === "reasoning") {
            if (event.type === "delta") pending += event.text; else pendingReasoning += event.text;
            if (!flushTimer) flushTimer = setTimeout(flush, 50);
          }
          if (event.type === "response-details") {
            if (flushTimer) clearTimeout(flushTimer);
            value = { ...value, response: event.details }; flush();
          }
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "done" && !event.valid && currentChat.current === chatId) setStatus(copy.ai.invalidResult);
        }
        if (part.done) break;
      }
    } catch (e) { if (!controller.signal.aborted && currentChat.current === chatId) setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally {
      if (flushTimer) clearTimeout(flushTimer);
      pending = ""; pendingReasoning = "";
      if (currentChat.current === chatId) { setRun(await aiApi<Run>("runs/" + id)); await loadMessages(chatId); setStream(null); }
      await loadChats();
    }
  }
  async function send() {
    const question = drafts[conversationId]?.trim(); if (!question || busy || loadingChat || activeRunId || sendLock.current) return;
    sendLock.current = true;
    const originalChat = conversationId, controller = new AbortController(); captureAbort.current = controller;
    setBusy(true); setError(""); setStatus(copy.ai.understanding); setClarification("");
    try {
      const chatId = await ensureChat();
      const limits = temporaryLimits[originalChat];
      if (limits && chatId !== originalChat) setTemporaryLimits((s) => ({ ...s, [chatId]: limits }));
      let page = scopeMode === "page" ? pageScope : undefined;
      if (scopeMode === "pinned" && pageScope?.entryId && pageScope.entryId === context?.selectedEntryId && pageScope.projectionId === context.projectionId) page = pageScope;
      let chartPreferences = context?.chartPreferences;
      if (page) {
        const { dataset } = await aiApi<{ dataset: { id: string; startTime: string; timezone: string } }>("page-context?sessionId=" + encodeURIComponent(page.replaySessionId), "GET", undefined, controller.signal);
        const { capturePdfChartPreferences } = await import("@/components/market-replay/use-replay-preferences");
        if (dataset) chartPreferences = capturePdfChartPreferences(dataset);
      }
      const plan = await aiApi<AssistantPlan>("assistant-plan", "POST", { conversationId: chatId, question, hasImages: assets.length > 0, limits,
        ...(scopeMode !== "none" ? page ? { page: { replaySessionId: page.replaySessionId, projectionId: page.projectionId, entryId: page.entryId,
          templateId: page.templateId, draft: page.draft, depth: "quick", chartPreferences, includeCurrentChart: page.includeCurrentChart, chartWindow: page.chartWindow, chartAccess: true } } : context ? { contextId: context.id } : {} : {}),
      }, controller.signal);
      controller.signal.throwIfAborted();
      if (plan.clarification) { setClarification(plan.clarification); setStatus(""); return; }
      setContext(plan.context); setChartImages(false);
      let includeImages = false;
      if (plan.context?.charts.length && (plan.prepareImages || (scopeMode === "pinned" && chartImages))) {
        setStatus(copy.ai.capturing);
        await captureContextCharts({ ...plan.context, charts: requestedCharts(plan.context, plan.imageRequest ?? { multiple: false, timeframes: [] }) }, controller.signal); includeImages = true; setChartImages(true);
      }
      controller.signal.throwIfAborted(); setStatus(copy.ai.starting);
      const value = await aiApi<{ id: string; task: string }>("runs", "POST", { conversationId: chatId, contextId: plan.context?.id, task: plan.task, planId: plan.planId, question, assetIds: assets, limits,
        chartImages: includeImages, executionMode: fixedMode ? "fixed-v1" : "tools-v1", requestId: createUuid() });
      if (controller.signal.aborted) { await aiApi("runs/" + value.id, "DELETE"); await loadChats(); return; }
      setDrafts((s) => ({ ...s, [originalChat]: s[originalChat]?.trim() === question ? "" : s[originalChat] ?? "", [chatId]: s[chatId]?.trim() === question ? "" : s[chatId] ?? "" })); setAssets([]); setStatus("");
      scrollToLatest.current = true; await loadMessages(chatId); await loadChats();
      if (value.task !== "sessionReview") void connectStream(value.id, chatId);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : copy.ai.failed); setStatus(""); }
    finally { setBusy(false); sendLock.current = false; }
  }
  async function stop() {
    captureAbort.current?.abort();
    if (activeRunId) await aiApi("runs/" + activeRunId, "DELETE");
    streamAbort.current?.abort(); setStream(null); setStatus(copy.ai.stopped); await loadChats();
  }
  async function retry(id: string, limits = temporaryLimits[conversationId], resume = false) {
    if (busy || activeRunId || sendLock.current) return;
    const chatId = conversationId;
    sendLock.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const value = await aiApi<{ id: string; task: string }>("runs/" + id + (resume ? "/resume" : "/retry"), "POST", { limits });
      await loadMessages(chatId); await loadChats();
      if (!resume && value.task !== "sessionReview") void connectStream(value.id, chatId);
    } catch (e) { setError(e instanceof Error ? e.message : copy.ai.failed); }
    finally { setBusy(false); sendLock.current = false; }
  }
  function adjustLimits(target?: Run) {
    setLimitsError(""); setLimitsDialog({ value: temporaryLimits[conversationId] ?? target?.budget?.limits ?? effectiveLimits, target });
  }
  async function applyLimits() {
    if (!limitsDialog) return;
    const parsed = aiLimitsSchema.safeParse(limitsDialog.value);
    if (!parsed.success) { setLimitsError(copy.ai.invalidLimits); return; }
    const { target } = limitsDialog, limits = parsed.data;
    setTemporaryLimits((s) => ({ ...s, [conversationId]: JSON.stringify(limits) === JSON.stringify(resolveLimits(config?.limits)) ? undefined : limits }));
    setLimitsDialog(null);
    if (target) await retry(target.id, limits, target.task === "sessionReview");
    else setStatus(copy.ai.limitsApplied);
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
  const automaticPage = scopeMode === "page" ? pageScope : null;
  const scopeTitle = scopeMode === "none" ? copy.ai.generalChat : automaticPage
    ? automaticPage.sessionName + (automaticPage.entryNo ? " · " + copy.ai.tradeNumber(automaticPage.entryNo) : " · " + copy.ai.wholeSession)
    : context ? context.sessionName + (context.selectedEntryId ? " · " + copy.ai.tradeNumber(context.entries[0]?.no ?? 0) : " · " + copy.ai.wholeSession) : copy.ai.generalChat;
  const scopeCaption = scopeMode === "none" ? copy.ai.noBusinessContext : automaticPage ? (automaticPage.includeCurrentChart ? copy.ai.followingChart : copy.ai.followingPage) : context ? (scopeMode === "pinned" ? copy.ai.pinnedContext : copy.ai.chatContext) : copy.ai.autoContextHint;
  const viewSources = (id: string) => void aiApi<FixedContext>("contexts/" + id).then(setSourceContext).catch((e) => setError(e.message));
  const showHistory = () => { setShowReports(true); void aiApi<typeof reports>("reports").then(setReports).catch((e) => setError(e.message)); };
  const assistantValue = useMemo(() => ({ open, attach, registerEditor }), [open, attach, registerEditor]);
  return <Assistant.Provider value={assistantValue}>
    {children}
    <AiAssistantLauncher hidden={open} onOpen={() => setOpen(true)} />
    <Dialog open={open} keepMounted modal={false} movable resizable defaultWidth={680} defaultHeight={780} title={copy.ai.title} description={endpoint ? endpoint.name + " · " + endpoint.defaultModel : copy.ai.unconfigured}
      layerClassName="z-[60]" contentClassName="flex min-h-0 flex-1 flex-col p-0" widthStorageKey="ai-window-width-v1" heightStorageKey="ai-window-height-v1"
      headerActions={<><Button asChild size="icon" variant="ghost"><Link href="/settings/ai" target="_blank" rel="noopener noreferrer" aria-label={copy.ai.openSettings}><Settings className="h-4 w-4" aria-hidden="true" /></Link></Button><Button size="icon" variant="ghost" aria-label={copy.ai.minimize} onClick={() => setOpen(false)}><Minus className="h-4 w-4" aria-hidden="true" /></Button></>}
      onClose={() => void close()}>
      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={(e) => { if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation(); }}>
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1"><Select value={conversationId || undefined} onValueChange={(id) => { setLoadingChat(true); setConversationId(id); }} disabled={busy || loadingChat}><SelectTrigger aria-label={copy.ai.chatHistory}><SelectValue placeholder={copy.ai.newChat} /></SelectTrigger><SelectContent className="z-[70]">{conversations.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.activeRunId ? " · " + copy.ai.running : ""}</SelectItem>)}</SelectContent></Select></div>
          <Button size="icon" variant="ghost" aria-label={copy.ai.newChat} disabled={busy || loadingChat} onClick={() => void newChat().catch((e) => { setError(e.message); setLoadingChat(false); })}><Plus className="h-4 w-4" aria-hidden="true" /></Button>
          <Button size="icon" variant="ghost" aria-label={copy.ai.history} onClick={showHistory}><History className="h-4 w-4" aria-hidden="true" /></Button>
          <ActionMenu label={copy.ai.chatActions} trigger={<Button size="icon" variant="ghost" aria-label={copy.ai.chatActions}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>} items={[
            { label: copy.ai.rename, icon: <Pencil className="h-4 w-4" aria-hidden="true" />, disabled: !conversationId || busy, onSelect: () => setRename(conversations.find((c) => c.id === conversationId)?.name ?? "") },
            { label: copy.ai.compatibilityOptions, icon: <Settings className="h-4 w-4" aria-hidden="true" />, onSelect: () => setOptionsOpen(true) },
            { label: copy.ai.clear, icon: <Eraser className="h-4 w-4" aria-hidden="true" />, disabled: !conversationId || busy, onSelect: () => setConfirmation("clear") },
            { label: copy.ai.delete, icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, destructive: true, disabled: !conversationId || busy, onSelect: () => setConfirmation("delete") },
          ]} />
        </div>
        <div ref={contentRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-white p-4">
          {messages.length >= 30 ? <Button variant="ghost" size="sm" onClick={() => void loadMessages(conversationId, messages[0].id)}>{copy.ai.older}</Button> : null}
          {loadingChat ? <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{copy.ai.loadingChat}</p> : null}
          {!loadingChat && !messages.length && !stream ? <div className="space-y-4 py-4 sm:py-6">
            <div className="flex items-start gap-3"><span className="rounded-lg border border-blue-100 bg-blue-50 p-2 text-blue-700"><Bot className="h-5 w-5" aria-hidden="true" /></span><div className="space-y-2"><h3 className="text-base font-semibold text-slate-950">{copy.ai.welcome}</h3><p className="text-sm leading-6 text-slate-600">{copy.ai.empty}</p></div></div>
            <div className="grid gap-2">{[
              { icon: <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />, text: (automaticPage?.entryId || context?.selectedEntryId) ? copy.ai.suggestTrade : (automaticPage?.includeCurrentChart ? copy.ai.suggestChart : copy.ai.suggestConcept) },
              { icon: <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />, text: (automaticPage?.entryId || context?.selectedEntryId) ? copy.ai.suggestDraft : copy.ai.suggestNumberedTrade },
              { icon: <ChartNoAxesCombined className="h-4 w-4 shrink-0" aria-hidden="true" />, text: copy.ai.suggestReport },
            ].map((item) => <Button key={item.text} variant="outline" className="h-auto min-h-10 justify-start whitespace-normal py-2 text-left text-slate-700" disabled={busy} onClick={() => { setDrafts((s) => ({ ...s, [conversationId]: item.text })); document.getElementById("ai-input")?.focus(); }}>{item.icon}{item.text}</Button>)}</div>
          </div> : null}
          {messages.map((m) => <AiMessageCard key={m.id} role={m.role} text={m.content} createdAt={m.createdAt} reference={m.reference} response={m.response} reads={m.reads} budget={m.budget} images={m.images}>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(m.content).then(() => setStatus(copy.ai.copied))}><Copy className="h-4 w-4" />{copy.ai.copy}</Button>
              {m.contextId ? <Button variant="ghost" size="sm" onClick={() => viewSources(m.contextId!)}>{copy.ai.sources}</Button> : null}
              {m.result && "draft" in JSON.parse(m.result) ? <Button variant="outline" size="sm" onClick={() => {
                void aiApi<AdoptPayload>("adopt/" + m.id, "POST", {}).then((payload) => {
                  if (!editor.current?.(payload)) throw new Error(copy.ai.applyUnavailable);
                  setStatus(copy.ai.applied); setOpen(false);
                }).catch((e) => setError(e.message));
              }}>{copy.ai.apply}</Button> : null}
              {m.role === "user" ? <Button variant="ghost" size="sm" disabled={busy || Boolean(activeRunId)} onClick={() => { if (m.runId) void retry(m.runId); }}>{copy.ai.retry}</Button> : null}
            </div>
          </AiMessageCard>)}
          {stream?.chat === conversationId && !messages.some((m) => m.role === "assistant" && m.runId === stream.runId) ? <AiMessageCard text={stream.text} createdAt={stream.startedAt} reasoning={stream.reasoning} reasoningMs={stream.response?.reasoningMs ?? stream.reasoningMs} response={stream.response} reads={stream.reads} images={mergeDisplayedImages(stream.images ?? [], run?.id === stream.runId ? run.images ?? [] : [])} budget={run?.id === stream.runId ? run.budget : undefined} live={!stream.response} /> : null}
          {activeRunId && stream?.chat !== conversationId ? <AiMessageCard text="" reads={run?.reads} budget={run?.budget} images={run?.images} live><p role="status" className="text-xs text-slate-600">{run?.task === "sessionReview" ? copy.ai.processedBatches(run.completedBatches) : copy.ai.running}</p></AiMessageCard> : null}
          {!activeRunId && run && ["FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status) ? <AiMessageCard text="" createdAt={run.response?.startedAt} response={run.response} reads={run.reads} images={messages.some((m) => m.role === "assistant" && m.runId === run.id) ? [] : run.images} budget={run.budget}><p className="text-xs text-slate-600">{copy.ai.unfinishedAnswer}</p><Button variant="outline" disabled={busy || loadingChat} onClick={() => adjustLimits(run)}>{run.task === "sessionReview" ? copy.ai.adjustAndContinue : copy.ai.adjustAndRetry}</Button></AiMessageCard> : null}
          {run?.task === "sessionReview" && ["INTERRUPTED", "FAILED", "CANCELLED", "INVALID_RESULT"].includes(run.status) ? <div className="space-y-2"><p className="text-xs text-slate-500">{copy.ai.continuingHint}</p><Button variant="outline" disabled={busy || Boolean(activeRunId)} onClick={() => void retry(run.id, undefined, true)}>{copy.ai.continue}</Button></div> : null}
        </div>
        <div className="max-h-[60dvh] shrink-0 space-y-3 overflow-y-auto border-t bg-slate-50 p-3">
          <div className="flex items-center gap-2"><Layers className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-700" title={scopeTitle}>{scopeTitle}</p><p className="text-xs text-slate-500">{scopeCaption}</p></div>
            <ActionMenu label={copy.ai.contextOptions} trigger={<Button variant="ghost" className="shrink-0 px-2" disabled={busy || Boolean(activeRunId)}>{copy.ai.changeContext}<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button>} items={[
              { label: copy.ai.followPage, onSelect: () => { setScopeMode("page"); setClarification(""); } },
              { label: copy.ai.chooseOtherContext, onSelect: () => setPickerOpen(true) },
              { label: copy.ai.generalChat, onSelect: () => { setScopeMode("none"); setClarification(""); } },
            ]} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-600"><span className="tabular-nums">{copy.ai.nextOutputLimit(formatInteger(effectiveLimits.outputTokens))}{temporaryLimits[conversationId] ? " · " + copy.ai.temporaryActive : ""}</span><Button variant="ghost" size="sm" disabled={busy || loadingChat || Boolean(activeRunId)} onClick={() => adjustLimits()}>{copy.ai.adjustLimits}</Button></div>
          {clarification ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status"><p>{clarification}</p><Button variant="ghost" className="mt-1 px-0 text-blue-700" onClick={() => setPickerOpen(true)}>{copy.ai.chooseOtherContext}</Button></div> : null}
          {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          {status ? <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-slate-600">{busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{status}</p> : null}
          {capturingRun && capturingRun === activeRunId ? <p role="status" className="flex items-center gap-2 text-xs text-slate-600"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{copy.ai.preparingChartImages}</p> : null}
          {assets.length ? <div className="flex max-h-24 gap-2 overflow-x-auto">{assets.map((id) => <Button key={id} variant="outline" className="h-auto p-1" aria-label={copy.ai.removeImage} onClick={() => setAssets((s) => s.filter((a) => a !== id))}><Image unoptimized width={96} height={64} className="h-16 max-w-24 object-contain" src={"/api/ai/assets/" + id} alt={copy.ai.imageHint} /></Button>)}</div> : null}
          <div className="space-y-2">
          <Label htmlFor="ai-input" className="sr-only">{copy.ai.title}</Label>
          <Textarea id="ai-input" rows={3} maxLength={8000} value={sendDraft} disabled={loadingChat} placeholder={copy.ai.placeholder} className="min-h-20 max-h-40 resize-y" aria-describedby="ai-composer-hint"
            onChange={(e) => setDrafts((s) => ({ ...s, [conversationId]: e.target.value }))}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void upload(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }} />
          <div className="flex items-center justify-between gap-2">
            <Button size="icon" variant="ghost" aria-label={copy.ai.attachImage} disabled={busy || Boolean(activeRunId) || assets.length >= 6} onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" aria-hidden="true" /></Button>
            <input ref={fileInput} type="file" className="hidden" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
            <div className="flex items-center gap-3"><span className="hidden text-xs text-slate-500 sm:inline">{copy.ai.sendHint}</span>{activeRunId || busy ? <Button variant="destructive" onClick={() => void stop()}><Square className="h-4 w-4" aria-hidden="true" />{copy.ai.stop}</Button> : <Button disabled={loadingChat || !sendDraft.trim() || !endpoint} onClick={() => void send()}><Send className="h-4 w-4" aria-hidden="true" />{copy.ai.send}</Button>}</div>
          </div>
          </div>
          <p id="ai-composer-hint" className="text-xs leading-5 text-slate-500">{copy.ai.autoSendHint}</p>
        </div>
      </div>
    </Dialog>
    <AiContextPicker open={pickerOpen} initialSessionId={pageScope?.replaySessionId ?? context?.replaySessionId} onClose={() => setPickerOpen(false)} onAttach={attach} />
    <Dialog open={Boolean(limitsDialog)} title={copy.ai.temporaryLimits} description={limitsDialog?.target ? copy.ai.retryLimitsHint : copy.ai.temporaryLimitsHint} onClose={() => setLimitsDialog(null)} layerClassName="z-[80]">
      {limitsDialog ? <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void applyLimits(); }}>
        {limitsDialog.target?.error ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">{limitsDialog.target.error}</p> : null}
        <AiLimitsFields value={limitsDialog.value} initialExpanded={Boolean(limitsDialog.target?.budget?.blocked && limitsDialog.target.budget.blocked.resource !== "outputTokens")} onChange={(value) => { setLimitsError(""); setLimitsDialog({ ...limitsDialog, value }); }} />
        {limitsError ? <p role="alert" className="text-sm text-red-700">{limitsError}</p> : null}
        <Button type="button" variant="ghost" onClick={() => { setLimitsError(""); setLimitsDialog({ ...limitsDialog, value: resolveLimits(config?.limits) }); }}>{copy.ai.resetLimits}</Button>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => setLimitsDialog(null)}>{copy.ai.cancel}</Button><Button type="submit" disabled={busy || Boolean(activeRunId)}>{limitsDialog.target ? limitsDialog.target.task === "sessionReview" ? copy.ai.adjustAndContinue : copy.ai.adjustAndRetry : copy.ai.applyLimits}</Button></div>
      </form> : null}
    </Dialog>
    <Dialog open={optionsOpen} title={copy.ai.compatibilityOptions} onClose={() => setOptionsOpen(false)} layerClassName="z-[80]">
      <div className="space-y-3"><CheckboxField checked={fixedMode} onChange={setFixedMode} disabled={busy || Boolean(activeRunId)}>{copy.ai.fixedMode}</CheckboxField><p className="text-xs text-slate-500">{copy.ai.fixedModeHint}</p></div>
    </Dialog>
    <Dialog open={Boolean(sourceContext)} title={copy.ai.sources} layerClassName="z-[80]" onClose={() => setSourceContext(null)}>
      {sourceContext ? <div className="space-y-4"><p className="text-sm font-medium">{sourceContext.sessionName} · {sourceContext.symbol}</p><p className="text-xs text-slate-500">{copy.ai.frozenAt(sourceContext.asOfTime)} · {sourceContext.timezone}</p><ContextSources key={sourceContext.id} context={sourceContext} /><div className="flex justify-end border-t pt-4"><Button variant="outline" disabled={busy || Boolean(activeRunId)} onClick={() => { setContext(sourceContext); setScopeMode("pinned"); setSourceContext(null); }}>{copy.ai.useTheseSources}</Button></div></div> : null}
    </Dialog>
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
      }}><summary className="cursor-pointer text-sm">{new Date(report.createdAt).toLocaleString("zh-CN")}</summary>{staleReports[report.id] ? <p className="my-2 text-xs text-amber-800">{copy.ai.sourceChanged}</p> : null}<Markdown text={report.content} /><Button variant="outline" onClick={() => { viewSources(report.contextId); setShowReports(false); }}>{copy.ai.sources}</Button></details>)}</div>
    </Dialog>
  </Assistant.Provider>;
}
