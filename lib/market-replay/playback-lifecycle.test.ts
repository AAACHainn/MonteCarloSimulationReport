import { describe, expect, it } from "vitest";
import { createPlaybackIntentTracker, retryReplayRead } from "./playback-lifecycle";

describe("playback intent ownership", () => {
  it("allows the operation that paused playback to restore it", () => {
    const tracker = createPlaybackIntentTracker();
    expect(tracker.mayResume(tracker.suspend(true))).toBe(true);
  });

  it("does not let an old operation override a later user pause", () => {
    const tracker = createPlaybackIntentTracker();
    const operation = tracker.suspend(true);
    tracker.invalidate();
    expect(tracker.mayResume(operation)).toBe(false);
  });

  it("does not start playback when the operation began while paused", () => {
    const tracker = createPlaybackIntentTracker();
    expect(tracker.mayResume(tracker.suspend(false))).toBe(false);
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
