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
import { formatMoney, formatNumber, formatInteger } from "@/lib/format";
import { createUuid } from "@/lib/uuid";
import { funds, payoutPreview, promotionPreview } from "@/lib/prop-practice/rules";
import { propResultLabel } from "@/lib/prop-practice/result-label";
import type { PropRuntime, readPropAccount } from "@/lib/prop-practice/service";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { PaperAccountMetrics } from "./paper-trading-panel";
const t = copy.propPractice;
type AccountView = "rules" | "payout" | "history" | "events";
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

function CompactRuleTable({ rules }: { rules: object }) {
  return <Table><TableBody>{ruleRows(rules).map(row => <TableRow key={row.path}>
    <TableCell className="px-0 py-1.5 text-slate-600">{row.label}</TableCell>
    <TableCell className="py-1.5 pl-3 pr-0 text-right tabular-nums">{row.value}</TableCell>
  </TableRow>)}</TableBody></Table>;
}

function RuleSnapshotCards({ snapshot }: { snapshot: PropRuntime["snapshot"] }) {
  const { risk, ...conditions } = snapshot.rules.evaluation;
  const { risk: fundedRisk, ...fundedConditions } = snapshot.rules.funded;
  return <div className="grid grid-cols-3 items-start gap-3">
    <Card><CardHeader className="p-4 pb-2"><CardTitle>{t.evaluation}</CardTitle></CardHeader><CardContent className="px-4 pb-4">
      <CompactRuleTable rules={{ ...risk, ...conditions }} />
    </CardContent></Card>
    <Card><CardHeader className="p-4 pb-2"><CardTitle>{t.funded}</CardTitle></CardHeader><CardContent className="space-y-3 px-4 pb-4">
      <CompactRuleTable rules={{ ...fundedRisk, ...fundedConditions }} />
      {snapshot.rules.funded.qualifyingDays !== null ? <p className="text-xs text-slate-500">{t.qualifyingHint}</p> : null}
      <div className="border-t pt-3"><p className="mb-1 text-sm font-medium">{t.payout}</p><CompactRuleTable rules={snapshot.rules.payout} /></div>
    </CardContent></Card>
    <Card><CardHeader className="p-4 pb-2"><CardTitle>{t.costs}</CardTitle></CardHeader><CardContent className="space-y-3 px-4 pb-4">
      <CompactRuleTable rules={{ purchaseCost: snapshot.rules.purchaseCost ?? null, activationCost: snapshot.rules.activationCost ?? null }} />
      <p className="text-xs text-slate-500">{t.costHint}</p>
      {snapshot.accountConfig ? <div className="border-t pt-3"><p className="mb-1 text-sm font-medium">{t.accountConfig}</p><CompactRuleTable rules={snapshot.accountConfig} /></div> : null}
      <p className="text-xs text-slate-500">{snapshot.calendar.session.timezone} · {t.ruleUnit}</p>
    </CardContent></Card>
  </div>;
}

export function PropAccountPanel({ sessionId, runtime, tradingSnapshot, busy: externalBusy, onBeforeOpen, onChanged }: {
  sessionId: string; runtime: PropRuntime; tradingSnapshot?: PaperSessionSnapshot | null; busy?: boolean; onBeforeOpen?: () => Promise<void>; onChanged?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false), [data, setData] = useState<AccountData | null>(null);
  const [view, setView] = useState<AccountView>("rules");
  const [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(""), [confirmation, setConfirmation] = useState<{ amount: number; requestId: string; version: number } | null>(null);
  const [success, setSuccess] = useState(false), [sessionStatus, setSessionStatus] = useState("ACTIVE");
  const [promotionConfirmation, setPromotionConfirmation] = useState<{ requestId: string; version: number; capital: string } | null>(null);
  const [promotionSuccess, setPromotionSuccess] = useState(false);
  const current = open && data ? data : runtime, { state, snapshot } = current, currency = snapshot.currency;
  const f = funds(state), preview = payoutPreview(snapshot.rules, state), progress = promotionPreview(snapshot.rules, state);
  const money = (value: number) => formatMoney(value, currency);
  async function reload() {
    const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}/prop-practice`, { cache: "no-store" });
    const result = await response.json(); if (!response.ok || !result.account) throw new Error(result.error ?? t.requestFailed);
    setData(result.account); setVersion(result.version); setSessionStatus(result.status);
    return { account: result.account as AccountData, version: result.version as number, status: result.status as string };
  }
  async function begin(nextView: AccountView) {
    setView(nextView); setBusy(true); setError(null); setSuccess(false); setOpen(true);
    try { await onBeforeOpen?.(); const result = await reload(); setAmount(String(result.account.preview.maximum)); }
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
  async function beginPromotion() {
    if (busy || externalBusy) return;
    setBusy(true); setError(null); setPromotionSuccess(false);
    try {
      await onBeforeOpen?.();
      const result = await reload();
      if (result.status !== "ACTIVE" || !promotionPreview(result.account.snapshot.rules, result.account.state).eligible) throw new Error(t.promotionUnavailable);
      setPromotionConfirmation({ requestId: createUuid(), version: result.version, capital: formatMoney(result.account.snapshot.rules.funded.risk.initialCapital, result.account.snapshot.currency) });
    } catch (e) { setError(e instanceof Error ? e.message : t.requestFailed); } finally { setBusy(false); }
  }
  async function promote() {
    if (!promotionConfirmation || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}/prop-practice/promote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: promotionConfirmation.version, requestId: promotionConfirmation.requestId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.requestFailed);
      setPromotionConfirmation(null); setPromotionSuccess(true); await reload(); await onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : t.requestFailed); } finally { setBusy(false); }
  }
  const summaryItems: [string, string][] = [[t.profit, money(f.profit)], [t.totalReceived, money(state.totalReceived)]];
  const viewTitle = { rules: t.rules, payout: t.payout, history: t.dailyLedger, events: t.events }[view];
  const requested = confirmation?.amount ?? Number(amount), received = Math.round(requested * snapshot.rules.payout.traderShare * 100) / 100;
  const confirmationDescription = `${t.requested}: ${money(requested)} · ${t.received}: ${money(received)} · ${t.balanceAfter}: ${money(preview.balance - requested)} · ${t.floorAfter}: ${money(preview.floorAfter)}。${t.payoutHint}`;
  return <>
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle>{snapshot.rules.name} · {propResultLabel(state, currency, formatMoney)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open && !promotionConfirmation && error ? <Alert role="alert" className="border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {promotionSuccess ? <Alert role="status" aria-live="polite" className="border-emerald-200 bg-emerald-50"><AlertDescription>{t.promotionSuccess}</AlertDescription></Alert> : null}
        <div className="grid grid-cols-4 gap-4 text-sm tabular-nums">
          {[[t.balance, f.balance], [t.equity, f.equity], [t.floor, f.floor], [t.remainingRisk, f.equity - f.floor]].map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-950">{money(Number(value))}</p></div>)}
        </div>
        {tradingSnapshot ? <div className="border-t pt-3"><PaperAccountMetrics snapshot={tradingSnapshot} compact includeBalances={false} extraItems={summaryItems} /></div> : <div className="grid grid-cols-4 gap-4 border-t pt-3 text-sm tabular-nums">{summaryItems.map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="font-medium">{value}</p></div>)}</div>}
        <p className={state.pause === "NONE" ? "text-xs text-slate-500" : "text-xs text-amber-800"}>{t.pause}: {t[state.pause]}</p>
        {state.result ? <p className="text-xs text-amber-800">{t.terminalHint}</p> : null}
        {state.failure ? <p className="text-xs text-red-700">{t.failure}: {state.failure.sequence} / {money(state.failure.equity)} / {money(state.failure.floor)} · {state.failure.phase === "EVALUATION" ? t.evaluation : t.funded}</p> : null}
        {state.phase === "EVALUATION" ? <div className="grid grid-cols-2 gap-4 border-t pt-3 text-sm tabular-nums">
          <div><p className="text-xs text-slate-500">{t.requiredProfit}</p><p className="mt-1 font-medium">{money(progress.requiredProfit)}</p></div>
          <div><p className="text-xs text-slate-500">{t.tradingDays}</p><p className="mt-1 font-medium">{progress.tradingDays} / {snapshot.rules.evaluation.minTradingDays ?? copy.common.dash}</p></div>
        </div> : null}
        {state.phase === "EVALUATION" && !state.result ? <p id="prop-promotion-hint" className="text-xs text-slate-500">{t.promotionHint}</p> : null}
        {state.phase === "FUNDED" && preview.qualification.requiredDays !== null ? <div className="border-t pt-3">
          <div className="grid grid-cols-2 gap-4 text-sm tabular-nums">
            <div><p className="text-xs text-slate-500">{t.qualifiedDays}</p><p className="mt-1 font-medium">{formatInteger(preview.qualification.qualifyingDays)} / {formatInteger(preview.qualification.requiredDays)}</p></div>
            <div><p className="text-xs text-slate-500">{t.qualifyingProfit}</p><p className="mt-1 font-medium">{money(preview.qualification.qualifyingProfit!)}</p></div>
          </div><p className="mt-2 text-xs text-slate-500">{t.qualifyingHint}</p>
        </div> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="outline" disabled={busy || externalBusy} onClick={() => void begin("rules")}>{t.rules}</Button>
          <Button variant="outline" disabled={busy || externalBusy} onClick={() => void begin("history")}>{t.dailyLedger}</Button>
          <Button variant="outline" disabled={busy || externalBusy} onClick={() => void begin("events")}>{t.events}</Button>
          {state.phase === "EVALUATION" && !state.result ? <Button disabled={busy || externalBusy || !progress.eligible} aria-describedby="prop-promotion-hint" onClick={() => void beginPromotion()}>{t.promote}</Button> : <Button disabled={busy || externalBusy} onClick={() => void begin("payout")}>{t.payout}</Button>}
        </div>
      </CardContent>
    </Card>
    <Dialog open={open && !confirmation && !promotionConfirmation} title={viewTitle} description={view === "rules" ? t.rulesSnapshotHint : view === "payout" ? t.payoutHint : undefined} className={view === "rules" ? "max-w-6xl" : view === "history" ? "max-w-4xl" : "max-w-2xl"} onClose={() => { if (!busy) setOpen(false); }}>
      <div className="space-y-4" aria-busy={busy}>
        {busy ? <p role="status">{copy.marketReplay.loading}</p> : null}
        {error ? <Alert role="alert" className="border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {success ? <Alert role="status" aria-live="polite" className="border-emerald-200 bg-emerald-50"><AlertDescription>{t.payoutSuccess}</AlertDescription></Alert> : null}
        {view === "payout" && (state.phase !== "FUNDED" || state.result) ? <Alert><AlertDescription>{t.previewUnavailable}</AlertDescription></Alert> : null}
        {view === "payout" && state.phase === "FUNDED" && !state.result ? <Card><CardHeader><CardTitle>{t.payout}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-xs text-slate-500">{t.payoutHint}</p><p className="text-sm tabular-nums">{t.maximumAvailable}: {money(preview.maximum)} · {t.minimum}: {money(snapshot.rules.payout.minimum)}</p><p className="text-xs text-slate-500">{t.limits}: {money(preview.limits.fraction)} / {preview.limits.maximum === null ? copy.common.dash : money(preview.limits.maximum)} / {preview.limits.buffer === null ? copy.common.dash : money(preview.limits.buffer)} / {money(preview.limits.risk)}</p>
          {preview.qualification.requiredDays !== null ? <div className="space-y-1"><p className="text-sm tabular-nums">{t.qualifiedDays}: {formatInteger(preview.qualification.qualifyingDays)} / {formatInteger(preview.qualification.requiredDays)} · {t.qualifyingProfit}: {money(preview.qualification.qualifyingProfit!)}</p><p className="text-xs text-slate-500">{t.qualifyingHint}</p></div> : null}
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (preview.eligible) { setError(null); setConfirmation({ amount: Number(amount), requestId: createUuid(), version }); } }}><div className="space-y-2"><Label htmlFor="prop-payout-amount">{t.requested}</Label><Input id="prop-payout-amount" type="number" step="0.01" min={snapshot.rules.payout.minimum} max={preview.maximum} required value={amount} onChange={e => setAmount(e.target.value)} disabled={busy || !preview.eligible} /></div><p className="text-xs tabular-nums">{t.received}: {money(received)} · {t.balanceAfter}: {money(preview.balance - Number(amount))} · {t.floorAfter}: {money(preview.floorAfter)}</p>{!preview.eligible ? <p className="text-xs text-amber-800">{t.previewUnavailable}</p> : null}<div className="flex justify-end border-t pt-4"><Button disabled={busy || !preview.eligible || sessionStatus !== "ACTIVE" || !data} type="submit">{t.payout}</Button></div></form>
        </CardContent></Card> : null}
        {view === "rules" ? <RuleSnapshotCards snapshot={snapshot} /> : null}
        {view === "history" ? <div className="flex justify-end"><Button asChild variant="outline"><Link href={`/api/replay-sessions/${encodeURIComponent(sessionId)}/prop-practice?download=1`}>{t.exportLedger}</Link></Button></div> : null}
        {view === "history" ? <Card><CardHeader><CardTitle>{t.history}</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>{t.day}</TableHead><TableHead>{t.pause}</TableHead><TableHead className="text-right">{t.dayProfit}</TableHead><TableHead className="text-right">{t.balance}</TableHead></TableRow></TableHeader><TableBody>{state.stages.flatMap(st => st.days.map(day => <TableRow key={st.kind + day.day}><TableCell>{new Date(day.day).toLocaleString("zh-CN", { timeZone: snapshot.calendar.session.timezone })} · {st.kind === "EVALUATION" ? t.evaluation : t.funded}</TableCell><TableCell>{day.stageEnded && !day.settled ? t.stageEnded : day.settled ? t.settled : t.pendingSettlement}</TableCell><TableCell className="text-right tabular-nums">{money(day.endRawNet - day.startRawNet)}</TableCell><TableCell className="text-right tabular-nums">{money(day.balance)}</TableCell></TableRow>))}</TableBody></Table></CardContent></Card> : null}
        {view === "payout" ? <Card><CardHeader><CardTitle>{t.payouts}</CardTitle></CardHeader><CardContent>{data?.payouts.length ? <Table><TableHeader><TableRow><TableHead>{t.day}</TableHead><TableHead className="text-right">{t.requested}</TableHead><TableHead className="text-right">{t.share}</TableHead><TableHead className="text-right">{t.received}</TableHead></TableRow></TableHeader><TableBody>{data.payouts.map(p => <TableRow key={p.id}><TableCell>{JSON.parse(p.evidence).day}</TableCell><TableCell className="text-right tabular-nums">{money(p.amount)}</TableCell><TableCell className="text-right tabular-nums">{money(p.share)}</TableCell><TableCell className="text-right tabular-nums">{money(p.received)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-slate-500">{t.noPayouts}</p>}</CardContent></Card> : null}
        {view === "events" ? <Card><CardHeader><CardTitle>{t.events}</CardTitle></CardHeader><CardContent>{data?.events.length ? <ul className="space-y-2 text-sm">{data.events.map(e => <li key={e.id}>{e.type in t ? String(t[e.type as keyof typeof t]) : e.type}</li>)}</ul> : <p className="text-sm text-slate-500">{t.noEvents}</p>}</CardContent></Card> : null}

      </div>
    </Dialog>
    <ConfirmDialog open={!!confirmation} title={t.payoutTitle} description={confirmationDescription} confirmLabel={t.payout} confirmVariant="default" isLoading={busy} error={error} onCancel={() => setConfirmation(null)} onConfirm={() => void payout()} />
    <ConfirmDialog open={!!promotionConfirmation} title={t.promotionTitle} description={promotionConfirmation ? t.promotionConfirm(promotionConfirmation.capital) : ""} confirmLabel={t.promote} confirmVariant="default" isLoading={busy} error={error} onCancel={() => { setPromotionConfirmation(null); setError(null); }} onConfirm={() => void promote()} />
  </>;
}
