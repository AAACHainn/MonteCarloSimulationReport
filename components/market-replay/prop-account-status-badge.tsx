import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/i18n";
import { promotionPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";

export function PropAccountStatusBadge({ runtime }: { runtime: PropRuntime }) {
  const { state, snapshot } = runtime, t = copy.propPractice;
  let label: string, color: string;
  if (state.result === "FAILED") {
    label = state.phase === "EVALUATION" ? t.evaluationFailed : t.fundedFailed;
    color = "border-red-200 dark:border-negative/40 bg-red-50 dark:bg-negative-background text-red-700 dark:text-negative";
  } else if (state.result === "STOPPED") {
    label = state.phase === "EVALUATION" ? t.evaluationStopped : t.fundedStopped;
    color = "border-slate-200 dark:border-border bg-slate-100 dark:bg-muted text-slate-600 dark:text-secondary-text";
  } else if (state.phase === "FUNDED" && state.pause !== "STAGE_WAIT") {
    label = t.fundedStage;
    color = "border-amber-200 dark:border-warning/40 bg-amber-50 dark:bg-warning-background text-amber-800 dark:text-warning";
  } else if (state.phase === "FUNDED" || promotionPreview(snapshot.rules, state).eligible) {
    label = t.evaluationQualified;
    color = "border-emerald-200 dark:border-positive/40 bg-emerald-50 dark:bg-positive-background text-emerald-700 dark:text-positive";
  } else {
    label = t.evaluationInProgress;
    color = "border-blue-200 dark:border-link/40 bg-blue-50 dark:bg-info-background text-blue-700 dark:text-link";
  }
  return <Badge role="status" className={"shrink-0 whitespace-nowrap " + color}>{label}</Badge>;
}
