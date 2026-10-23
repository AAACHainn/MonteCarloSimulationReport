import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/i18n";
import { promotionPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";

export function PropAccountStatusBadge({ runtime }: { runtime: PropRuntime }) {
  const { state, snapshot } = runtime, t = copy.propPractice;
  let label: string, color: string;
  if (state.result === "FAILED") {
    label = state.phase === "EVALUATION" ? t.evaluationFailed : t.fundedFailed;
    color = "border-red-200 bg-red-50 text-red-700";
  } else if (state.result === "STOPPED") {
    label = state.phase === "EVALUATION" ? t.evaluationStopped : t.fundedStopped;
    color = "border-slate-200 bg-slate-100 text-slate-600";
  } else if (state.phase === "FUNDED" && state.pause !== "STAGE_WAIT") {
    label = t.fundedStage;
    color = "border-amber-200 bg-amber-50 text-amber-800";
  } else if (state.phase === "FUNDED" || promotionPreview(snapshot.rules, state).eligible) {
    label = t.evaluationQualified;
    color = "border-emerald-200 bg-emerald-50 text-emerald-700";
  } else {
    label = t.evaluationInProgress;
    color = "border-blue-200 bg-blue-50 text-blue-700";
  }
  return <Badge role="status" className={"shrink-0 whitespace-nowrap " + color}>{label}</Badge>;
}
