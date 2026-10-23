import { copy } from "@/lib/i18n";
import { formatInterval } from "@/lib/market-replay/types";
import type { EntryDiscipline } from "./training-gate";

export function initialPlanReview(discipline: EntryDiscipline | null | undefined): string {
  if (discipline?.mode !== "PLAN") return "";
  return copy.trainingGate.planReview(
    formatInterval(discipline.displayIntervalSeconds),
    copy.trainingGate.marketContexts[discipline.context],
    discipline.plan,
  );
}
