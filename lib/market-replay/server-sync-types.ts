import type { PaperFillData, PaperSessionSnapshot } from "@/lib/paper-trading/types";
import type { ReplayContextRun } from "@/lib/replay-sessions/context-runs";

/** Requests contain progress and chart context, never client trade results. */
export type ReplayServerRequest = {
  generation: number;
  requestId: string;
  confirmedSequence: number;
  syncVersion: number;
  dataVersion: number;
  historyVersion: number;
  expectedPaperVersion: number | null;
  targetSequence: number;
  contextRuns: ReplayContextRun[];
};
export type DisplayAdvanceResult = { completedDisplayBucketStart: string | null; reachedVisibleBucket: boolean };
export type ReplayServerResult = {
  requestId: string;
  fromSequence: number;
  currentSequence: number;
  generation: number;
  syncVersion: number;
  dataVersion: number;
  historyVersion: number;
  fills: PaperFillData[];
  snapshot: PaperSessionSnapshot | null;
  displayAdvance?: DisplayAdvanceResult;
};
