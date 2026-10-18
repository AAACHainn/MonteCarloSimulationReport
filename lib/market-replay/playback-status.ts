import { copy } from "@/lib/i18n";
import type { ReplayPauseReason } from "./playback-lifecycle";
import type { ReplayState } from "./types";

export type ReplaySaveStatus = "idle" | "saving" | "saved" | "error";

export function replayPlaybackStatusText(input: {
  retrying: boolean;
  playbackRequested: boolean;
  recoveryNotice: string | null;
  buffering: boolean;
  saveStatus: ReplaySaveStatus;
  activityVisible: boolean;
  replayStatus: ReplayState["status"] | undefined;
  pauseReason: ReplayPauseReason | null;
}) {
  if (input.retrying) return input.playbackRequested ? copy.marketReplay.advanceRetrying : copy.marketReplay.advanceRetryingPaused;
  if (input.recoveryNotice) return input.recoveryNotice;
  if (input.saveStatus === "error") return copy.marketReplay.saveError;
  if (input.replayStatus === "paused") {
    if (input.pauseReason === "page-hidden") return copy.marketReplay.pauseReasonHidden;
    if (input.pauseReason === "operation-failed") return copy.marketReplay.pauseReasonOperationFailed;
    if (input.pauseReason === "source-failed") return copy.marketReplay.pauseReasonSourceFailed;
    if (input.pauseReason === "sync-conflict") return copy.marketReplay.pauseReasonSyncConflict;
    if (input.pauseReason === "state-mismatch") return copy.marketReplay.pauseReasonStateMismatch;
  }
  if (input.activityVisible) {
    if (input.saveStatus === "saving") return copy.marketReplay.saving;
    if (input.buffering) return copy.marketReplay.buffering;
    if (input.replayStatus === "paused" && input.pauseReason === "operation") return copy.marketReplay.pauseReasonOperation;
  }
  return "";
}
