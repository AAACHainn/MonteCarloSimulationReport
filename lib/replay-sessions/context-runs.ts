import type { PaperJournalContext } from "@/lib/paper-trading/types";

export type ReplayContextRun = {
  fromSequence: number;
  toSequence: number;
  generation: number;
  context: PaperJournalContext | null;
};
export function appendContextRun(runs: ReplayContextRun[], sequence: number, context: PaperJournalContext | null, generation: number) {
  const last = runs.at(-1);
  if (last && last.toSequence + 1 === sequence && last.generation === generation && JSON.stringify(last.context) === JSON.stringify(context)) {
    last.toSequence = sequence;
  } else runs.push({ fromSequence: sequence, toSequence: sequence, generation, context: context ? { ...context } : null });
}
export function validContextRuns(runs: ReplayContextRun[], from: number, to: number, generation: number) {
  let next = from;
  for (const run of runs) {
    if (run.fromSequence !== next || run.toSequence < run.fromSequence || run.toSequence > to || run.generation !== generation) return false;
    next = run.toSequence + 1;
  }
  return next === to + 1;
}
