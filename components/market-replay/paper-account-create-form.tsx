"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatMoney, formatInteger } from "@/lib/format";
import type { CreatePaperAccountInput } from "@/lib/prop-practice/account-input";
import type { PropRules } from "@/lib/prop-practice/rules";
import { useReplaySession } from "./replay-session-context";
import { PropRuleSummary, type PropTemplateRow } from "./prop-template-manager";

export function PaperAccountCreateForm({ busy, error, onCreate }: {
  busy: boolean; error: string | null; onCreate: (input: CreatePaperAccountInput) => Promise<boolean>;
}) {
  const session = useReplaySession();
  const id = useId();
  const [category, setCategory] = useState("STANDARD");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<PropTemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [currency, setCurrency] = useState("USDT");
  const isProp = category === "PROP_PRACTICE";
  const t = copy.propPractice;
  const selected = templates.find(row => row.versions[0]?.id === templateId);
  const rules: PropRules | null = selected ? JSON.parse(selected.versions[0].rules) : null;

  useEffect(() => {
    if (!isProp) return;
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    void fetch("/api/prop-practice-templates", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t.requestFailed);
      const active = data.templates.filter((row: PropTemplateRow) => row.active && row.versions.length);
      setTemplates(active);
      setTemplateId(previous => active.some((row: PropTemplateRow) => row.versions[0].id === previous) ? previous : "");
    }).catch(reason => {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : t.requestFailed);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isProp, retry, t.requestFailed]);

  return <form className="space-y-4" aria-busy={busy || loading} onSubmit={event => {
      event.preventDefault();
      if (busy || (isProp && (!selected || loading || loadError))) return;
      const data = new FormData(event.currentTarget);
      const config = { currency, commissionBps: Number(data.get("commissionBps")), slippageBps: Number(data.get("slippageBps")) };
      void onCreate(isProp ? { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: templateId }
        : { ...config, accountCategory: "STANDARD", initialCapital: Number(data.get("initialCapital")) });
    }}>
      <div className="space-y-2"><Label htmlFor={`${id}-category`}>{t.category}</Label>
        <Select value={category} disabled={busy} onValueChange={value => { setCategory(value); setDetailsOpen(false); }}>
          <SelectTrigger id={`${id}-category`} aria-describedby={`${id}-category-hint`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="STANDARD">{t.standard}</SelectItem><SelectItem value="PROP_PRACTICE" disabled={session?.mode !== "TRAINING"}>{t.title}</SelectItem></SelectContent>
        </Select>
        <p id={`${id}-category-hint`} className="text-xs text-slate-500">{session?.mode === "LIVE_REPLAY" ? t.liveReplayAccountHint : t.accountFixed}</p>
      </div>
      {isProp ? <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor={`${id}-template`}>{t.template}</Label><div className="flex items-center gap-1"><Button asChild variant="ghost" size="sm"><Link href="/prop-practice-templates" target="_blank" rel="noopener noreferrer">{t.manageTemplates}</Link></Button><Button type="button" variant="ghost" size="icon" aria-label={t.retryTemplates} disabled={busy || loading} onClick={() => setRetry(value => value + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button></div></div>
        <Select value={templateId} disabled={busy || loading} onValueChange={value => { setTemplateId(value); setDetailsOpen(false); }}>
          <SelectTrigger id={`${id}-template`}><SelectValue placeholder={loading ? copy.marketReplay.loading : t.selectTemplate} /></SelectTrigger>
          <SelectContent>{templates.map(row => <SelectItem key={row.id} value={row.versions[0].id}>{JSON.parse(row.versions[0].rules).name} · {t.version} {formatInteger(row.versions[0].version)}</SelectItem>)}</SelectContent>
        </Select>
        {loadError ? <div className="space-y-2"><p role="alert" className="text-xs text-red-600">{loadError}</p><Button type="button" variant="outline" disabled={busy || loading} onClick={() => setRetry(value => value + 1)}>{t.retryTemplates}</Button></div> : !loading && !templates.length ? <p role="status" className="text-xs text-slate-500">{t.empty}</p> : null}
        {rules ? <div className="space-y-2">
          <p className="text-xs tabular-nums text-slate-600">{t.evaluation} · {t.initialCapital} {formatMoney(rules.evaluation.risk.initialCapital, currency)}</p>
          <Button type="button" variant="ghost" disabled={busy} aria-expanded={detailsOpen} aria-controls={`${id}-rules`} onClick={() => setDetailsOpen(value => !value)}>
            {detailsOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}{detailsOpen ? t.hideRules : t.showRules}
          </Button>
          {detailsOpen ? <div id={`${id}-rules`}><PropRuleSummary rules={rules} currency={currency} /></div> : null}
        </div> : null}
      </div> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {!isProp ? <div className="space-y-2"><Label htmlFor={`${id}-capital`}>{copy.paperTrading.initialCapital}</Label><Input id={`${id}-capital`} name="initialCapital" type="number" min="0.01" step="any" defaultValue="100000" disabled={busy} required /></div> : null}
        <div className="space-y-2"><Label htmlFor={`${id}-currency`}>{copy.paperTrading.currency}</Label><Input id={`${id}-currency`} name="currency" value={currency} onChange={event => setCurrency(event.target.value)} maxLength={12} disabled={busy} required /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`${id}-fee`}>{copy.paperTrading.commissionBps}</Label><Input id={`${id}-fee`} name="commissionBps" type="number" min="0" max="10000" step="any" defaultValue="0" disabled={busy} required /></div>
          <div className="space-y-2"><Label htmlFor={`${id}-slip`}>{copy.paperTrading.slippageBps}</Label><Input id={`${id}-slip`} name="slippageBps" type="number" min="0" max="10000" step="any" defaultValue="0" disabled={busy} required /></div>
      </div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end border-t pt-4"><Button type="submit" disabled={busy || (isProp && (!selected || loading || !!loadError))}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{busy ? copy.paperTrading.creating : isProp ? t.createPracticeAccount : copy.paperTrading.createAccount}</Button></div>
    </form>;
}
