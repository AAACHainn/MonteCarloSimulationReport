import type { PaperFillData, PaperSessionSnapshot, PaperSessionSnapshotUpdate } from "@/lib/paper-trading/types";
import type { ReplayContextRun } from "@/lib/replay-sessions/context-runs";

/** Requests contain progress and chart context, never client trade results. */
export type ReplayServerRequest = {
  snapshotMode?: "LIVE";
  batchMode?: "BULK";
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
  propStopped?: boolean;
  requestedTargetSequence?: number;
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

/** LIVE responses may omit unchanged history; resolve against the confirmed base before use. */
export type ReplayServerResponse = Omit<ReplayServerResult, "snapshot"> & {
  snapshot: PaperSessionSnapshotUpdate | null;
};
