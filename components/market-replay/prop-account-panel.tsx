"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatMoney, formatNumber } from "@/lib/format";
import { createUuid } from "@/lib/uuid";
import { funds, payoutPreview, evaluationProgress } from "@/lib/prop-practice/rules";
import { propResultLabel } from "@/lib/prop-practice/result-label";
import type { PropRuntime, readPropAccount } from "@/lib/prop-practice/service";
import { PropRuleSummary } from "./prop-template-manager";
const t = copy.propPractice;
type AccountData = NonNullable<Awaited<ReturnType<typeof readPropAccount>>>;
function ruleRows(rules: object, prefix = ""): { path: string; label: string; value: string }[] {
  return Object.entries(rules).flatMap(([key, value]) => {
    const label = key in t ? t[key as keyof typeof t] : key;
    if (value !== null && typeof value === "object") return ruleRows(value, prefix + (typeof label === "string" ? label : key) + " / ");
    if (["schemaVersion", "name", "description"].includes(key)) return [];
    const display = value == null ? t.optional : key === "mode" ? t[value as "STATIC" | "EOD_BALANCE"] : typeof value === "number" ? formatNumber(value) : String(value);
    return [{ path: prefix + key, label: prefix + (typeof label === "string" ? label : key), value: display }];
  });
}
export function PropAccountPanel({ sessionId, runtime, busy: externalBusy, onBeforeOpen, onChanged }: {
  sessionId: string; runtime: PropRuntime; busy?: boolean; onBeforeOpen?: () => Promise<void>; onChanged?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false), [data, setData] = useState<AccountData | null>(null);
  const [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(""), [confirmation, setConfirmation] = useState<{ amount: number; requestId: string; version: number } | null>(null);
  const [success, setSuccess] = useState(false), [sessionStatus, setSessionStatus] = useState("ACTIVE");
  const current = open && data ? data : runtime, { state, snapshot } = current, currency = snapshot.currency;
  const f = funds(state), preview = payoutPreview(snapshot.rules, state), progress = evaluationProgress(snapshot.rules, state);
  const money = (value: number) => formatMoney(value, currency);
  async function reload() {
    const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}/prop-practice`, { cache: "no-store" });
    const result = await response.json(); if (!response.ok || !result.account) throw new Error(result.error ?? t.requestFailed);
    setData(result.account); setVersion(result.version); setSessionStatus(result.status); return result.account as AccountData;
  }
  async function begin() {
    setBusy(true); setError(null); setSuccess(false); setOpen(true);
    try { await onBeforeOpen?.(); const result = await reload(); setAmount(String(result.preview.maximum)); }
    catch (e) { setError(e instanceof Error ? e.message : t.requestFailed); } finally { setBusy(false); }
  }
  async function payout() {
    if (!confirmation || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}/prop-practice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: confirmation.version, requestId: confirmation.requestId, amount: confirmation.amount }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.requestFailed);
      setConfirmation(null); setSuccess(true); await reload(); await onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : t.requestFailed); } finally { setBusy(false); }
  }
  const requested = confirmation?.amount ?? Number(amount), received = Math.round(requested * snapshot.rules.payout.traderShare * 100) / 100;
  const confirmationDescription = `${t.requested}: ${money(requested)} · ${t.received}: ${money(received)} · ${t.balanceAfter}: ${money(preview.balance - requested)} · ${t.floorAfter}: ${money(preview.floorAfter)}。${t.payoutHint}`;
  return <>
    <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border bg-white p-3 text-xs tabular-nums">
      <strong>{t.title} · {propResultLabel(state, currency, formatMoney)}</strong><span>{t.balance} {money(f.balance)}</span><span>{t.equity} {money(f.equity)}</span><span>{t.floor} {money(f.floor)}</span><span>{t.remainingRisk} {money(f.equity - f.floor)}</span>
      <Button size="sm" variant="outline" disabled={busy || externalBusy} onClick={() => void begin()}>{t.rules} / {t.payout}</Button>
      {state.pause !== "NONE" ? <span className="text-amber-800">{t[state.pause]}</span> : null}
    </div>
    <Dialog open={open && !confirmation} title={t.title} description={t.ledgerHint} onClose={() => { if (!busy) setOpen(false); }}>
      <div className="space-y-4" aria-busy={busy}>
        {busy ? <p role="status">{copy.marketReplay.loading}</p> : null}
        {error ? <Alert role="alert" className="border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {success ? <Alert role="status" aria-live="polite" className="border-emerald-200 bg-emerald-50"><AlertDescription>{t.payoutSuccess}</AlertDescription></Alert> : null}
        <Card><CardHeader><CardTitle>{propResultLabel(state, currency, formatMoney)}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm tabular-nums"><p>{t.pause}: {t[state.pause]}</p><p>{t.balance}: {money(f.balance)} · {t.equity}: {money(f.equity)} · {t.floor}: {money(f.floor)}</p><p>{t.profit}: {money(f.profit)} · {t.totalReceived}: {money(state.totalReceived)}</p>
          {state.result ? <p className="text-amber-800">{t.terminalHint}</p> : null}
          {state.failure ? <p className="text-red-700">{t.failure}: {state.failure.sequence} / {money(state.failure.equity)} / {money(state.failure.floor)} · {state.failure.phase === "EVALUATION" ? t.evaluation : t.funded}</p> : null}
          {state.phase === "EVALUATION" ? <p>{t.progress}: {t.requiredProfit} {money(progress.requiredProfit)} · {t.tradingDays} {progress.tradingDays} / {snapshot.rules.evaluation.minTradingDays ?? copy.common.dash} · {t.qualifiedDays} {progress.qualifyingDays} / {snapshot.rules.evaluation.qualifyingDays ?? copy.common.dash}</p> : null}
        </CardContent></Card>
        {state.phase === "FUNDED" && !state.result ? <Card><CardHeader><CardTitle>{t.payout}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-xs text-slate-500">{t.payoutHint}</p><p className="text-sm tabular-nums">{t.maximumAvailable}: {money(preview.maximum)} · {t.minimum}: {money(snapshot.rules.payout.minimum)}</p><p className="text-xs text-slate-500">{t.limits}: {money(preview.limits.fraction)} / {preview.limits.maximum === null ? copy.common.dash : money(preview.limits.maximum)} / {preview.limits.buffer === null ? copy.common.dash : money(preview.limits.buffer)} / {money(preview.limits.risk)}</p>
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (preview.eligible) { setError(null); setConfirmation({ amount: Number(amount), requestId: createUuid(), version }); } }}><div className="space-y-2"><Label htmlFor="prop-payout-amount">{t.requested}</Label><Input id="prop-payout-amount" type="number" step="0.01" min={snapshot.rules.payout.minimum} max={preview.maximum} required value={amount} onChange={e => setAmount(e.target.value)} disabled={busy || !preview.eligible} /></div><p className="text-xs tabular-nums">{t.received}: {money(received)} · {t.balanceAfter}: {money(preview.balance - Number(amount))} · {t.floorAfter}: {money(preview.floorAfter)}</p>{!preview.eligible ? <p className="text-xs text-amber-800">{t.previewUnavailable}</p> : null}<div className="flex justify-end border-t pt-4"><Button disabled={busy || !preview.eligible || sessionStatus !== "ACTIVE" || !data} type="submit">{t.payout}</Button></div></form>
        </CardContent></Card> : null}
        <Card><CardHeader><CardTitle>{t.snapshot}</CardTitle></CardHeader><CardContent className="space-y-4"><PropRuleSummary rules={snapshot.rules} currency={currency} /><p className="text-xs text-slate-500">{t.costHint} · {snapshot.calendar.session.timezone} · {t.ruleUnit}</p><Table><TableBody>{ruleRows(snapshot.rules).map(row => <TableRow key={row.path}><TableCell>{row.label}</TableCell><TableCell className="text-right tabular-nums">{row.value}</TableCell></TableRow>)}</TableBody></Table><Button asChild variant="outline" size="sm"><Link href={`/api/replay-sessions/${encodeURIComponent(sessionId)}/prop-practice?download=1`}>{t.exportLedger}</Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>{t.history}</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>{t.day}</TableHead><TableHead>{t.pause}</TableHead><TableHead className="text-right">{t.dayProfit}</TableHead><TableHead className="text-right">{t.balance}</TableHead></TableRow></TableHeader><TableBody>{state.stages.flatMap(st => st.days.map(day => <TableRow key={st.kind + day.day}><TableCell>{new Date(day.day).toLocaleString("zh-CN", { timeZone: snapshot.calendar.session.timezone })} · {st.kind === "EVALUATION" ? t.evaluation : t.funded}</TableCell><TableCell>{day.settled ? t.settled : t.pendingSettlement}</TableCell><TableCell className="text-right tabular-nums">{money(day.endRawNet - day.startRawNet)}</TableCell><TableCell className="text-right tabular-nums">{money(day.balance)}</TableCell></TableRow>))}</TableBody></Table></CardContent></Card>
        <Card><CardHeader><CardTitle>{t.payouts}</CardTitle></CardHeader><CardContent>{data?.payouts.length ? <Table><TableHeader><TableRow><TableHead>{t.day}</TableHead><TableHead className="text-right">{t.requested}</TableHead><TableHead className="text-right">{t.share}</TableHead><TableHead className="text-right">{t.received}</TableHead></TableRow></TableHeader><TableBody>{data.payouts.map(p => <TableRow key={p.id}><TableCell>{JSON.parse(p.evidence).day}</TableCell><TableCell className="text-right tabular-nums">{money(p.amount)}</TableCell><TableCell className="text-right tabular-nums">{money(p.share)}</TableCell><TableCell className="text-right tabular-nums">{money(p.received)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-slate-500">{t.noPayouts}</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>{t.events}</CardTitle></CardHeader><CardContent>{data?.events.length ? <ul className="space-y-2 text-sm">{data.events.map(e => <li key={e.id}>{e.type in t ? String(t[e.type as keyof typeof t]) : e.type}</li>)}</ul> : <p className="text-sm text-slate-500">{t.noEvents}</p>}</CardContent></Card>
        {snapshot.accountConfig ? <Card><CardHeader><CardTitle>{t.accountConfig}</CardTitle></CardHeader><CardContent><Table><TableBody>{ruleRows(snapshot.accountConfig).map(row => <TableRow key={row.path}><TableCell>{row.label}</TableCell><TableCell className="text-right tabular-nums">{row.value}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : null}
      </div>
    </Dialog>
    <ConfirmDialog open={!!confirmation} title={t.payoutTitle} description={confirmationDescription} confirmLabel={t.payout} confirmVariant="default" isLoading={busy} error={error} onCancel={() => setConfirmation(null)} onConfirm={() => void payout()} />
  </>;
}
