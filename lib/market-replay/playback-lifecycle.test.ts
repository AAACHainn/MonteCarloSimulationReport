import { describe, expect, it } from "vitest";
import { createPlaybackIntentTracker, retryReplayRead } from "./playback-lifecycle";

describe("playback intent ownership", () => {
  it("resumes only after every temporary suspension is released", () => {
    const tracker = createPlaybackIntentTracker();
    tracker.play();
    const first = tracker.suspend();
    const second = tracker.suspend();
    expect(tracker.release(first)).toBe(false);
    expect(tracker.release(second)).toBe(true);
    expect(tracker.release(second)).toBe(false);
  });

  it("does not resume after a later user pause", () => {
    const tracker = createPlaybackIntentTracker();
    tracker.play();
    const operation = tracker.suspend();
    tracker.pause();
    expect(tracker.release(operation)).toBe(false);
  });

  it("waits for an existing operation when the user requests playback", () => {
    const tracker = createPlaybackIntentTracker();
    const operation = tracker.suspend();
    tracker.play();
    expect(tracker.canPlay()).toBe(false);
    expect(tracker.release(operation)).toBe(true);
  });

  it("invalidates asynchronous work after a newer user intent", () => {
    const tracker = createPlaybackIntentTracker();
    const oldPlayback = tracker.play();
    tracker.pause();
    const newPlayback = tracker.play();
    expect(tracker.isCurrent(oldPlayback)).toBe(false);
    expect(tracker.isCurrent(newPlayback)).toBe(true);
  });
});

describe("source read retry", () => {
  it("recovers from one transient read failure", async () => {
    let attempts = 0;
    const result = await retryReplayRead(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary");
      return "ok";
    }, async () => undefined);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("surfaces the final error after bounded retries", async () => {
    let attempts = 0;
    await expect(retryReplayRead(async () => {
      attempts += 1;
      throw new Error("offline");
    }, async () => undefined)).rejects.toThrow("offline");
    expect(attempts).toBe(3);
  });
});
