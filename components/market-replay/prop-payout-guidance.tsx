"use client";

import { Check, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { copy } from "@/lib/i18n";
import { formatInteger, formatMoney } from "@/lib/format";
import type { explainPayout, PayoutBlockReason } from "@/lib/prop-practice/payout-explanation";
import type { payoutPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";

const t = copy.propPractice;
export function PropPayoutGuidance({ runtime, preview, explanation }: {
  runtime: PropRuntime; preview: ReturnType<typeof payoutPreview>; explanation: ReturnType<typeof explainPayout>;
}) {
  if (preview.eligible) return <Alert role="status" aria-live="polite" className="flex items-center gap-2 border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
    <Check className="h-4 w-4 shrink-0" aria-hidden="true" /><p>{t.payoutConditionsMet}</p>
  </Alert>;
  const labels: Record<PayoutBlockReason, string> = {
    phase: t.payoutBlockedPhase, failed: t.fundedFailed, stopped: t.roundStopped,
    STAGE_WAIT: t.STAGE_WAIT, PAYOUT_DAY: t.PAYOUT_DAY, BOUNDARY: t.boundaryOrderBlocked,
    observation: t.payoutNeedsObservation, positions: t.payoutBlockedPositions, orders: t.payoutBlockedOrders,
    qualifyingDays: t.payoutBlockedDays(formatInteger(Math.max(0, (preview.qualification.requiredDays ?? 0) - preview.qualification.qualifyingDays))),
    fraction: t.payoutBlockedFraction, maximum: t.payoutBlockedMaximum, buffer: t.payoutBlockedBuffer, risk: t.payoutBlockedRisk,
  };
  const { reasons, gap } = explanation, money = (amount: number) => formatMoney(amount, runtime.snapshot.currency);
  return <Alert id="prop-payout-blocked" role="status" aria-live="polite" className="flex items-start gap-2 border-amber-200 bg-amber-50 p-3 text-amber-800">
    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <div className="min-w-0 space-y-2">
      <AlertTitle className="mb-0 text-sm font-semibold leading-relaxed">{reasons.length === 1 ? t.payoutBlockedBecause(labels[reasons[0]]) : t.payoutBlockedTitle}</AlertTitle>
      <AlertDescription className="space-y-2 text-xs leading-relaxed text-amber-800">
        {reasons.length > 1 ? <ul className="list-disc space-y-1 pl-4">{reasons.map(reason => <li key={reason}>{labels[reason]}</li>)}</ul> : null}
        {reasons.length === 0 ? <p>{t.payoutConditionsPending}</p> : null}
        {gap ? <>
          <p className="tabular-nums">{t.payoutProfitGap} <strong className="font-semibold">{money(gap.additionalNetProfit)}</strong></p>
          <p className="tabular-nums">{t.payoutGapBalances(money(preview.balance), money(gap.requiredBalance))}
            {reasons.includes("buffer") && gap.retainedBalance !== null ? <> {t.payoutGapRetained(money(runtime.snapshot.rules.payout.minimum), money(gap.retainedBalance))}</> : null}
          </p>
        </> : null}
      </AlertDescription>
    </div>
  </Alert>;
}
