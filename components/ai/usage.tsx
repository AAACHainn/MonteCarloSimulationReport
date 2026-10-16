"use client";

import type { BudgetView } from "@/lib/ai/budget";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";

export function AiUsage({ value }: { value: BudgetView }) {
  const { limits, lastUsage } = value;
  const known = value.inputTokens + value.outputTokens, partial = value.totalTokens === null;
  return <details className="rounded-md border bg-white text-xs text-slate-600">
    <summary className="min-h-10 cursor-pointer rounded-md px-3 py-2 leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {copy.ai.usageTitle} · {known || !partial ? copy.ai.tokenTotal(formatInteger(known), partial) : copy.ai.usageUnknown} · {copy.ai.nextOutputLimit(formatInteger(limits.outputTokens))}
    </summary>
    <div className="space-y-3 border-t p-3">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 tabular-nums">
        <dt>{copy.ai.inputTokens}</dt><dd>{value.inputReported ? formatInteger(value.inputTokens) + (partial ? "+" : "") : copy.ai.usageNotReported}</dd>
        <dt>{copy.ai.outputTokens}</dt><dd>{value.outputReported ? formatInteger(value.outputTokens) + (partial ? "+" : "") : copy.ai.usageNotReported}</dd>
        <dt>{copy.ai.lastOutputTokens}</dt><dd>{copy.ai.usedLimit(lastUsage?.output == null ? copy.ai.usageNotReported : formatInteger(lastUsage.output), formatInteger(limits.outputTokens))}</dd>
        <dt>{value.task === "sessionReview" ? copy.ai.limitLabels.maxAnalysisCalls : copy.ai.limitLabels.maxModelCalls}</dt><dd>{copy.ai.usedLimit(formatInteger(value.modelCalls), formatInteger(value.task === "sessionReview" ? limits.maxAnalysisCalls : limits.maxModelCalls))}</dd>
        <dt>{copy.ai.limitLabels.maxToolCalls}</dt><dd>{copy.ai.usedLimit(formatInteger(value.toolCalls), formatInteger(limits.maxToolCalls))}</dd>
        <dt>{value.task === "sessionReview" ? copy.ai.limitLabels.maxAnalysisChars : copy.ai.limitLabels.maxInputChars}</dt><dd>{copy.ai.usedLimit(formatInteger(value.estimatedChars), formatInteger(value.task === "sessionReview" ? limits.maxAnalysisChars : limits.maxInputChars))}</dd>
        <dt>{copy.ai.limitLabels.inputChars}</dt><dd>{formatInteger(limits.inputChars)}</dd>
      </dl>
      {partial ? <p>{copy.ai.usagePartial}</p> : null}
      <p className="leading-5">{copy.ai.usageHint}</p>
      {value.legacy ? <p>{copy.ai.usageLegacy}</p> : null}
      {value.blocked ? <p className="text-red-700">{copy.ai.budgetExceeded(value.blocked.resource, value.blocked.used, value.blocked.limit)}</p> : null}
    </div>
  </details>;
}
