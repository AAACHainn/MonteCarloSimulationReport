"use client";

import { useId } from "react";
import { CircleAlert } from "lucide-react";
import { copy } from "@/lib/i18n";
import { getSqnAssessment } from "@/lib/trade-journal/calculations";

export function SqnStatLabel({
  sqn,
  tradeCount,
}: {
  sqn: number | null;
  tradeCount: number;
}) {
  const tooltipId = useId();
  const assessment = getSqnAssessment(sqn, tradeCount);
  const assessmentText = getAssessmentText(sqn, tradeCount, assessment);

  return (
    <span className="group relative inline-flex items-center gap-1">
      <span>{copy.tradeJournals.statSqn}</span>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
        aria-label={copy.tradeJournals.sqn.helpLabel}
        aria-describedby={tooltipId}
      >
        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-7 z-[170] hidden w-80 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-md border bg-white p-3 text-left text-xs font-normal leading-5 text-slate-600 shadow-lg group-hover:block group-focus-within:block"
      >
        <span className="block font-semibold text-slate-950">{copy.tradeJournals.sqn.title}</span>
        <span className="mt-1 block">{copy.tradeJournals.sqn.description}</span>
        <span className="mt-2 block font-mono text-[11px] text-slate-800">{copy.tradeJournals.sqn.formula}</span>
        <span className="mt-1 block">{copy.tradeJournals.sqn.capNote}</span>
        <span className="mt-2 block rounded bg-slate-50 px-2 py-1 font-medium text-slate-800">
          {assessmentText}
        </span>
        <span className="mt-2 block font-medium text-slate-950">{copy.tradeJournals.sqn.ratingTitle}</span>
        <span className="mt-1 grid grid-cols-[6.5rem_1fr] gap-x-2">
          {copy.tradeJournals.sqn.ratingScale.map((item) => (
            <span key={item.range} className="contents">
              <span className="font-mono text-slate-800">{item.range}</span>
              <span>{item.label}</span>
            </span>
          ))}
        </span>
        <span className="mt-2 block text-slate-500">{copy.tradeJournals.sqn.disclaimer}</span>
      </span>
    </span>
  );
}

function getAssessmentText(
  sqn: number | null,
  tradeCount: number,
  assessment: ReturnType<typeof getSqnAssessment>,
) {
  if (sqn === null) return copy.tradeJournals.sqn.unavailable;

  const count = tradeCount.toLocaleString("zh-CN");
  if (assessment.reliability === "INSUFFICIENT_SAMPLE" || assessment.rating === null) {
    return copy.tradeJournals.sqn.insufficientSample.replace("{count}", count);
  }

  const rating = copy.tradeJournals.sqn.ratingLabels[assessment.rating];
  const template = assessment.reliability === "PRELIMINARY"
    ? copy.tradeJournals.sqn.preliminary
    : copy.tradeJournals.sqn.established;

  return template
    .replace("{count}", count)
    .replace("{rating}", rating);
}
