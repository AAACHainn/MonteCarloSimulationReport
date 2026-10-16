"use client";

import { memo, useEffect, useState, type ReactNode } from "react";
import { Bot, BrainCircuit, ChevronRight, UserRound } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copy, defaultLocale } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import type { ResponseDetails } from "@/lib/ai/response-details";

export const AiMarkdown = memo(function AiMarkdown({ text }: { text: string }) {
  return <div className="min-w-0 break-words text-sm leading-6 [&_code]:break-all [&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-medium [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-slate-50 [&_th]:p-2 [&_ul]:list-disc">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      img: () => null,
      table: ({ children }) => <div className="mb-3 overflow-x-auto"><table>{children}</table></div>,
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{children}</a>,
    }}>{text}</ReactMarkdown>
  </div>;
});

function Elapsed({ startedAt, durationMs, live, thinking = false }: { startedAt?: string; durationMs?: number | null; live: boolean; thinking?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live || durationMs != null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, durationMs, startedAt]);
  const milliseconds = durationMs ?? (live && startedAt ? Math.max(0, now - Date.parse(startedAt)) : null);
  if (milliseconds === null) return null;
  return <span className="tabular-nums" title={copy.ai.elapsedHint}>{thinking ? copy.ai.seconds(formatNumber(milliseconds / 1000)) : copy.ai.elapsed(formatNumber(milliseconds / 1000))}</span>;
}

export function AiMessageCard({ role = "assistant", text, createdAt, reference, response, live = false, reasoning = response?.reasoning ?? "", reasoningMs = response?.reasoningMs, children }: {
  role?: string; text: string; createdAt?: string; reference?: string; response?: ResponseDetails | null;
  live?: boolean; reasoning?: string; reasoningMs?: number | null; children?: ReactNode;
}) {
  const user = role === "user", Icon = user ? UserRound : Bot;
  return <article className={"min-w-0 space-y-3 rounded-lg border p-3 text-left " + (user ? "ml-auto w-fit max-w-[95%] border-blue-100 bg-blue-50" : "mr-auto w-full border-slate-200 bg-slate-50")} aria-label={user ? copy.ai.userMessage : copy.ai.assistantMessage} aria-busy={live}>
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      <span className={"inline-flex items-center gap-1.5 font-medium " + (user ? "text-blue-700" : "text-slate-700")}><Icon className="h-4 w-4" aria-hidden="true" />{user ? copy.ai.you : copy.ai.title}</span>
      {createdAt ? <time dateTime={createdAt} className="tabular-nums">{new Date(createdAt).toLocaleString(defaultLocale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}</time> : null}
      {!user ? <Elapsed startedAt={response?.startedAt ?? createdAt} durationMs={response?.durationMs} live={live} /> : null}
    </header>
    {reference ? <p className="break-words text-xs text-slate-500">{reference}</p> : null}
    {!user && reasoning ? <details className="group rounded-md border border-blue-100 bg-white">
      <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-2 rounded-md px-3 py-2 text-xs text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        <BrainCircuit className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{live && !text ? copy.ai.thinking : copy.ai.reasoning}</span>
        <Elapsed startedAt={response?.startedAt ?? createdAt} durationMs={reasoningMs} live={live} thinking />
      </summary>
      <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-blue-100 px-3 py-2 text-xs leading-6 text-slate-600">{reasoning}</div>
    </details> : null}
    {text ? <AiMarkdown text={text} /> : live ? <p className="text-sm text-slate-600" role="status">{reasoning ? copy.ai.thinking : copy.ai.running}…</p> : null}
    {children}
  </article>;
}
