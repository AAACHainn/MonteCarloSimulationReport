"use client";

import type { ReactNode } from "react";
import { ArrowRight, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { formatMoney, formatPercent } from "@/lib/format";
import type { payoutPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";
import { PropPayoutConditions } from "./prop-payout-overview";
import { PropPayoutGuidance } from "./prop-payout-guidance";
import { explainPayout, type PayoutLimitKey } from "@/lib/prop-practice/payout-explanation";
import { cn } from "@/lib/utils";

const t = copy.propPractice;
type Preview = ReturnType<typeof payoutPreview>;
type ReceiptProps = { runtime: PropRuntime; preview: Preview; amount: number; received: number };

export function PropPayoutReceipt({ runtime, preview, amount, received }: ReceiptProps) {
  const money = (value: number) => formatMoney(value, runtime.snapshot.currency);
  return <dl className="mt-4 divide-y rounded-lg border bg-slate-50 px-3 text-xs tabular-nums">
    {[[t.payoutAccountDebit, money(amount)], [t.received, money(received)], [t.share, money(Math.round((amount - received) * 100) / 100)], [t.balanceAfter, money(preview.balance - amount)], [t.floorAfter, money(preview.floorAfter)]].map(([label, value]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 py-3"><dt className="text-slate-500">{label}</dt><dd className="font-semibold text-slate-950">{value}</dd></div>)}
  </dl>;
}

export function PropPayoutForm({ runtime, preview, amount, received, onAmountChange, busy, canSubmit, onBack, onSubmit, historyAction }: {
  runtime: PropRuntime; preview: Preview; amount: string; received: number; onAmountChange: (amount: string) => void;
  busy: boolean; canSubmit: boolean; onBack: () => void; onSubmit: () => void; historyAction?: ReactNode;
}) {
  const { snapshot } = runtime, rules = snapshot.rules.payout;
  const money = (value: number) => formatMoney(value, snapshot.currency);
  const explanation = explainPayout(snapshot.rules, runtime.state, preview);
  const limitLabels: Record<PayoutLimitKey, string> = { fraction: t.payoutLimitFraction, maximum: t.maximum, buffer: t.payoutLimitBuffer, risk: t.payoutLimitRisk };
  const hasAmount = preview.eligible && amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0;
  const value = (n: number) => hasAmount ? money(n) : copy.common.dash;
  return <div className="space-y-4">
    <p className="text-xs text-blue-700">{t.payoutApplicationStep}</p>
    <Card className="border-blue-200 bg-blue-50 shadow-none"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-xs text-blue-700">{t.maximumAvailable}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{money(preview.maximum)}</p></div><Badge className={preview.eligible ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600"}>{preview.eligible ? t.payoutReady : t.payoutPending}</Badge></CardContent></Card>
    <PropPayoutConditions runtime={runtime} preview={preview} />
    <PropPayoutGuidance runtime={runtime} preview={preview} explanation={explanation} />
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label htmlFor="prop-payout-amount">{t.requested}</Label>
          <div className="relative"><Input id="prop-payout-amount" className="pr-16 font-semibold tabular-nums" type="number" inputMode="decimal" step="0.01" min={rules.minimum} max={preview.maximum} required value={amount} onChange={e => onAmountChange(e.target.value)} disabled={busy || !preview.eligible} aria-describedby={`prop-payout-range${preview.eligible ? "" : " prop-payout-blocked"}`} /><span className="pointer-events-none absolute right-3 top-3 text-xs text-slate-500">{snapshot.currency}</span></div>
          <p id="prop-payout-range" className="text-xs leading-relaxed text-slate-500">{preview.eligible ? `${t.payoutRange} ${money(rules.minimum)} – ${money(preview.maximum)}` : `${t.minimum} ${money(rules.minimum)}`}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || !preview.eligible} onClick={() => onAmountChange(String(rules.minimum))}>{t.payoutMinimumAmount}</Button><Button type="button" variant="outline" disabled={busy || !preview.eligible} onClick={() => onAmountChange(String(preview.maximum))}>{t.payoutMaximumAmount}</Button></div>
        </div>
        <Card className="bg-slate-50 shadow-none"><CardContent className="space-y-3 p-4"><p className="text-xs text-slate-500">{t.payoutEstimatedReceived}</p><p className={hasAmount && received > 0 ? "text-2xl font-semibold tabular-nums text-emerald-700" : "text-2xl font-semibold tabular-nums text-slate-950"}>{value(received)}</p><dl className="space-y-2 text-xs tabular-nums"><div className="flex justify-between gap-3"><dt className="text-slate-500">{t.payoutTraderShare}</dt><dd className="font-medium">{formatPercent(rules.traderShare * 100)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">{t.share}</dt><dd className="font-medium">{value(Math.round((Number(amount) - received) * 100) / 100)}</dd></div></dl></CardContent></Card>
      </div>
      <dl className="grid grid-cols-3 gap-3 border-t pt-4 text-xs tabular-nums">{[[t.balanceAfter, value(preview.balance - Number(amount))], [t.floorAfter, value(preview.floorAfter)], [t.payoutRiskAfter, value(preview.balance - Number(amount) - preview.floorAfter)]].map(([label, display]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-950">{display}</dd></div>)}</dl>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer rounded-md py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.payoutLimitDetails}</summary>
        <dl className="space-y-3 rounded-md bg-slate-50 p-4 tabular-nums">
          {explanation.limits.map(limit => <div key={limit.key} className={cn("flex flex-wrap items-start justify-between gap-3", limit.blocking && "rounded-md bg-amber-50 p-2 text-amber-800")}>
            <dt className="flex flex-wrap items-center gap-2">{limitLabels[limit.key]}{limit.blocking ? <span className="font-medium">{t.payoutCurrentLimit}</span> : null}</dt>
            <dd className={cn("font-semibold", limit.blocking ? "text-amber-800" : "text-slate-700")}>{limit.value === null ? t.optional : money(limit.value)}</dd>
          </div>)}
          <div className="flex flex-wrap justify-between gap-3"><dt>{t.payoutLimitFinal}</dt><dd className="font-semibold text-slate-700">{money(preview.maximum)}</dd></div>
        </dl>
      </details>
      <p className="flex items-start gap-2 rounded-md border bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t.payoutHint}</p>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">{historyAction}<Button variant="outline" type="button" disabled={busy} onClick={onBack}>{t.payoutBack}</Button><Button type="submit" disabled={busy || !preview.eligible || !canSubmit}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t.payoutNext}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button></div>
    </form>
  </div>;
}
