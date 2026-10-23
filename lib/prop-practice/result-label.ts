import { copy } from "@/lib/i18n";
import type { PropState } from "./rules";
export function propResultLabel(state: PropState, currency: string, money: (n: number, currency: string) => string) {
  if (state.result === "FAILED") return state.totalReceived > 0 ? copy.propPractice.successPayout(money(state.totalReceived, currency))
    : state.phase === "EVALUATION" ? copy.propPractice.evaluationFailed : copy.propPractice.fundedFailed;
  if (state.result === "STOPPED") return state.phase === "EVALUATION" ? copy.propPractice.evaluationStopped : copy.propPractice.fundedStopped;
  return state.phase === "EVALUATION" ? copy.propPractice.evaluation : copy.propPractice.funded;
}
