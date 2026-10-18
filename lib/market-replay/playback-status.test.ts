import { describe, expect, it } from "vitest";
import { copy } from "@/lib/i18n";
import { replayPlaybackStatusText } from "./playback-status";

const normal: Parameters<typeof replayPlaybackStatusText>[0] = {
  retrying: false, playbackRequested: false, recoveryNotice: null, buffering: false,
  saveStatus: "idle", activityVisible: false, replayStatus: "paused", pauseReason: "user",
};

describe("quiet replay status feedback", () => {
  it.each(["paused", "playing"] as const)("keeps rapid saving/saved cycles quiet while %s", (replayStatus) => {
    const labels = Array.from({ length: 100 }, (_, index) => replayPlaybackStatusText({
      ...normal, replayStatus, saveStatus: index % 2 ? "saving" : "saved",
    }));
    expect(new Set(labels)).toEqual(new Set([""]));
  });
  it("shows a slow save only while it remains pending", () => {
    expect(replayPlaybackStatusText({ ...normal, saveStatus: "saving", activityVisible: true })).toBe(copy.marketReplay.saving);
    expect(replayPlaybackStatusText({ ...normal, saveStatus: "saved", activityVisible: true })).toBe("");
  });
  it("keeps short buffering and temporary operation pauses quiet", () => {
    expect(replayPlaybackStatusText({ ...normal, buffering: true })).toBe("");
    expect(replayPlaybackStatusText({ ...normal, pauseReason: "operation" })).toBe("");
    expect(replayPlaybackStatusText({ ...normal, buffering: true, activityVisible: true })).toBe(copy.marketReplay.buffering);
    expect(replayPlaybackStatusText({ ...normal, pauseReason: "operation", activityVisible: true })).toBe(copy.marketReplay.pauseReasonOperation);
  });
  it.each([false, true])("shows retries immediately with playbackRequested=%s", (playbackRequested) => {
    expect(replayPlaybackStatusText({ ...normal, retrying: true, playbackRequested })).toBe(
      playbackRequested ? copy.marketReplay.advanceRetrying : copy.marketReplay.advanceRetryingPaused,
    );
  });
  it("never hides a save failure behind buffering or delayed activity", () => {
    expect(replayPlaybackStatusText({ ...normal, buffering: true, saveStatus: "error" })).toBe(copy.marketReplay.saveError);
  });
  it("preserves recovery notices immediately", () => {
    expect(replayPlaybackStatusText({ ...normal, recoveryNotice: copy.marketReplay.advanceConflict })).toBe(copy.marketReplay.advanceConflict);
  });
  it.each([
    ["page-hidden", copy.marketReplay.pauseReasonHidden],
    ["operation-failed", copy.marketReplay.pauseReasonOperationFailed],
    ["source-failed", copy.marketReplay.pauseReasonSourceFailed],
    ["sync-conflict", copy.marketReplay.pauseReasonSyncConflict],
    ["state-mismatch", copy.marketReplay.pauseReasonStateMismatch],
  ] as const)("preserves an actionable %s pause notice", (pauseReason, expected) => {
    expect(replayPlaybackStatusText({ ...normal, pauseReason })).toBe(expected);
  });
});
