"use client";

import { ArrowRight, Check, CircleAlert, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import { formatInteger, formatMoney, formatNumber } from "@/lib/format";
import type { payoutPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";
import { cn } from "@/lib/utils";

const t = copy.propPractice;
type Preview = ReturnType<typeof payoutPreview>;
type Props = { runtime: PropRuntime; preview: Preview };

function readiness({ runtime: { state, snapshot }, preview }: Props) {
  if (state.result) return { label: t.payoutEnded, note: state.result === "FAILED" ? t.roundFailed : t.roundStopped, tone: state.result === "FAILED" ? "text-red-700 dark:text-negative" : "text-slate-500 dark:text-muted-foreground" };
  if (preview.eligible) return { label: t.payoutReady, note: t.payoutConditionsMet, tone: "text-emerald-700 dark:text-positive" };
  if (state.pause === "PAYOUT_DAY") return { label: t.payoutResumePending, note: t.payoutNextDay, tone: "text-amber-800 dark:text-warning" };
  if (!["NONE", "DATA_END"].includes(state.pause)) return { label: t.payoutResumePending, note: t[state.pause], tone: "text-amber-800 dark:text-warning" };
  const daysPending = !preview.qualification.passed, amountPending = preview.maximum < snapshot.rules.payout.minimum;
  const note = daysPending && amountPending ? t.payoutDaysAndAmountPending : daysPending ? t.payoutDaysPending : amountPending ? t.payoutAmountPending
    : !state.last ? t.payoutNeedsObservation : !state.last.flat || state.last.pending > 0 ? t.payoutFlatOrdersPending : t.payoutConditionsPending;
  return { label: t.payoutPending, note, tone: "text-amber-800 dark:text-warning" };
}

export function PropAccountBadges({ runtime: { state, snapshot } }: Pick<Props, "runtime">) {
  const isEvaluation = state.phase === "EVALUATION";
  const status = state.result === "FAILED" ? { label: isEvaluation ? t.evaluationFailed : t.fundedFailed, style: "border-red-200 dark:border-negative/40 bg-red-50 dark:bg-negative-background text-red-700 dark:text-negative" }
    : state.result === "STOPPED" ? { label: isEvaluation ? t.evaluationStopped : t.fundedStopped, style: "border-slate-200 dark:border-border bg-slate-100 dark:bg-muted text-slate-600 dark:text-secondary-text" }
    : state.pause === "NONE" ? { label: t.NONE, style: "border-emerald-200 dark:border-positive/40 bg-emerald-50 dark:bg-positive-background text-emerald-700 dark:text-positive" }
    : { label: state.pause === "PAYOUT_DAY" ? t.payoutDayPaused : state.pause === "DATA_END" ? t.DATA_END : t.payoutPaused, style: "border-amber-200 dark:border-warning/40 bg-amber-50 dark:bg-warning-background text-amber-800 dark:text-warning" };
  return <div className="flex flex-wrap items-center justify-end gap-2">
    <Badge className={isEvaluation ? "border-blue-200 dark:border-link/40 bg-blue-50 dark:bg-info-background text-blue-700 dark:text-link" : "border-amber-200 dark:border-warning/40 bg-amber-50 dark:bg-warning-background text-amber-800 dark:text-warning"}>{isEvaluation ? t.evaluationStage : t.fundedStage}</Badge>
    <Badge className={status.style}><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{status.label}</Badge>
    {state.result && state.totalReceived > 0 ? <Badge className="border-emerald-200 dark:border-positive/40 bg-emerald-50 dark:bg-positive-background text-emerald-700 dark:text-positive">{t.successPayout(formatMoney(state.totalReceived, snapshot.currency))}</Badge> : null}
  </div>;
}

export function PropPayoutReadiness({ runtime, preview, disabled, onViewConditions }: Props & { disabled?: boolean; onViewConditions: () => void }) {
  const status = readiness({ runtime, preview }), q = preview.qualification;
  const complete = q.requiredDays === null ? 0 : Math.min(q.qualifyingDays, q.requiredDays);
  return <Card className="shadow-none">
    <CardHeader className="p-5 pb-4"><div className="flex items-center justify-between gap-3"><CardTitle>{t.payoutReadiness}</CardTitle><span className={cn("text-xs font-medium", status.tone)}>{status.label}</span></div></CardHeader>
    <CardContent className="space-y-3 p-5 pt-0">
      {q.requiredDays !== null ? <>
        <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-slate-500 dark:text-muted-foreground">{t.settledQualifiedDays}</span><p className="tabular-nums"><strong className="text-2xl font-semibold text-slate-950 dark:text-foreground">{formatInteger(q.qualifyingDays)}</strong><span className="text-sm text-slate-500 dark:text-muted-foreground"> / {formatInteger(q.requiredDays)} {t.daysUnit}</span></p></div>
        <div role="progressbar" aria-label={t.qualifiedDays} aria-valuemin={0} aria-valuemax={q.requiredDays} aria-valuenow={complete} aria-valuetext={`${formatInteger(q.qualifyingDays)} / ${formatInteger(q.requiredDays)} ${t.daysUnit}`}>
          {q.requiredDays <= 10 ? <div className="flex gap-1.5">{Array.from({ length: q.requiredDays }, (_, i) => <span key={i} className={cn("h-1.5 min-w-0 flex-1 rounded-sm", i < complete ? "bg-emerald-500" : "bg-slate-100 dark:bg-muted")} />)}</div>
            : <div className="h-1.5 overflow-hidden rounded-sm bg-slate-100 dark:bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${complete / q.requiredDays * 100}%` }} /></div>}
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-muted-foreground"><p>{t.qualifyingProfit} <strong className="font-semibold tabular-nums text-slate-700 dark:text-secondary-text">{formatMoney(q.qualifyingProfit!, runtime.snapshot.currency)}</strong></p><span>{q.passed ? t.qualifyingDaysMet : t.daysRemaining(formatInteger(q.requiredDays - complete))}</span></div>
      </> : <p className="py-3 text-sm text-slate-600 dark:text-secondary-text">{t.qualifyingDaysDisabled}</p>}
      <div className={cn("flex flex-wrap items-center gap-x-2 rounded-md px-3 py-1 text-xs", preview.eligible ? "bg-emerald-50 dark:bg-positive-background text-emerald-700 dark:text-positive" : "bg-slate-50 dark:bg-muted text-slate-600 dark:text-secondary-text")}>
        {preview.eligible ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <p className="min-w-0 flex-1">{status.note}</p>
        <Button variant="ghost" className="ml-auto px-0 text-xs text-blue-700 dark:text-link" disabled={disabled} onClick={onViewConditions}>{t.viewPayoutConditions}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t pt-3"><span className="text-xs text-slate-500 dark:text-muted-foreground">{t.maximumAvailable}</span><strong className="text-xl font-semibold tabular-nums text-slate-950 dark:text-foreground">{formatNumber(preview.maximum)} <span className="text-xs font-normal text-slate-500 dark:text-muted-foreground">{runtime.snapshot.currency}</span></strong></div>
    </CardContent>
  </Card>;
}

export function PropPayoutConditions({ runtime, preview }: Props) {
  const { state, snapshot } = runtime, q = preview.qualification;
  const conditions = [
    ...(q.requiredDays === null ? [] : [{ label: t.qualifiedDays, value: `${formatInteger(q.qualifyingDays)} / ${formatInteger(q.requiredDays)} ${t.daysUnit}`, passed: q.passed }]),
    { label: t.payoutFlatOrders, value: state.last?.flat && state.last.pending === 0 ? t.payoutFlatOrdersMet : t.payoutFlatOrdersPending, passed: !!state.last?.flat && state.last.pending === 0 },
    { label: t.pause, value: state.result === "FAILED" ? t.fundedFailed : state.result === "STOPPED" ? t.fundedStopped : !state.last ? t.payoutNeedsObservation : t[state.pause], passed: !state.result && !!state.last && ["NONE", "DATA_END"].includes(state.pause) },
    { label: t.payoutAmountCondition, value: `${formatMoney(preview.maximum, snapshot.currency)} / ${formatMoney(snapshot.rules.payout.minimum, snapshot.currency)}`, passed: preview.maximum >= snapshot.rules.payout.minimum },
  ];
  return <ul className="space-y-3">{conditions.map(condition => <li key={condition.label} className="flex flex-wrap items-start justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-slate-600 dark:text-secondary-text">{condition.passed ? <Check className="h-4 w-4 text-emerald-700 dark:text-positive" aria-hidden="true" /> : <CircleAlert className="h-4 w-4 text-amber-800 dark:text-warning" aria-hidden="true" />}{condition.label}</span><span className={cn("text-right tabular-nums", condition.passed ? "text-emerald-700 dark:text-positive" : "text-amber-800 dark:text-warning")}>{condition.value}</span></li>)}</ul>;
}
