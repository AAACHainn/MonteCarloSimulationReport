import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackIntentTracker } from "./playback-lifecycle";
import { HistoryVersionConflict } from "./history-version";
import { assertForwardReplayResult, requestReplayAdvance, retryReplayOperation, waitForReplayRetry } from "./server-request";

const result = { currentSequence: 50, generation: 1 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.useRealTimers());

describe("server advance retry and playback", () => {
  it("keeps the last displayed candle through network/500/429 failures and reuses identical request bytes", async () => {
    const tracker = createPlaybackIntentTracker(); tracker.play();
    let suspension: ReturnType<typeof tracker.suspend> | undefined;
    let visible = { currentSequence: 45, generation: 1 };
    const seen: string[] = [];
    const send = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(init?.body));
      expect(visible.currentSequence).toBe(45);
      if (seen.length === 1) throw new TypeError("offline");
      if (seen.length === 2) return json({ error: "busy" }, 500);
      if (seen.length === 3) return json({ error: "busy" }, 429);
      return json(result);
    });
    const receipt = await requestReplayAdvance<typeof result>({ fetch: send, url: "/sync", body: '{"requestId":"same-command"}',
      signal: new AbortController().signal, onRetry: () => { suspension ??= tracker.suspend(); },
      wait: async () => { expect(tracker.canPlay()).toBe(false); expect(visible.currentSequence).toBe(45); },
    });
    assertForwardReplayResult(visible, receipt); visible = receipt;
    expect(visible.currentSequence).toBe(50);
    expect(new Set(seen).size).toBe(1);
    expect(tracker.release(suspension!)).toBe(true);
    expect(tracker.canPlay()).toBe(true);
  });

  it.each(["user", "hidden"])("does not resume when %s pauses while an acknowledged command is being retried", async () => {
    const tracker = createPlaybackIntentTracker(); tracker.play();
    let suspension: ReturnType<typeof tracker.suspend> | undefined;
    const send = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(json(result));
    const receipt = await requestReplayAdvance<typeof result>({ fetch: send, url: "/sync", body: "fixed",
      signal: new AbortController().signal, onRetry: () => { suspension ??= tracker.suspend(); },
      wait: async () => { tracker.pause(); },
    });
    expect(receipt).toEqual(result);
    expect(tracker.release(suspension!)).toBe(false);
    expect(tracker.canPlay()).toBe(false);
  });

  it("leaves manual steps paused after recovery", async () => {
    const tracker = createPlaybackIntentTracker();
    let suspension: ReturnType<typeof tracker.suspend> | undefined;
    const send = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(json(result));
    await requestReplayAdvance({ fetch: send, url: "/sync", body: "fixed", signal: new AbortController().signal,
      onRetry: () => { suspension ??= tracker.suspend(); }, wait: async () => undefined });
    expect(tracker.release(suspension!)).toBe(false);
  });

  it("times out a hanging request and retries the same command automatically", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    })).mockResolvedValueOnce(json(result));
    const onRetry = vi.fn();
    const pending = requestReplayAdvance({ fetch: send, url: "/sync", body: "fixed", signal: new AbortController().signal, onRetry, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toEqual(result);
    expect(send.mock.calls.map(call => call[1].body)).toEqual(["fixed", "fixed"]);
  });

  it.each([400, 404, 409])("preserves progress and surfaces a permanent %s without endless retries", async status => {
    const send = vi.fn().mockResolvedValue(json({ error: "conflict", code: "STATE_CONFLICT" }, status));
    const retry = vi.fn();
    await expect(requestReplayAdvance({ fetch: send, url: "/sync", body: "fixed", signal: new AbortController().signal, onRetry: retry }))
      .rejects.toMatchObject({ status, code: "STATE_CONFLICT" });
    expect(send).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled();
  });

  it("recovers a receipt after a concurrent scope conflict", async () => {
    const send = vi.fn().mockResolvedValueOnce(json({ error: "conflict", code: "SESSION_CONFLICT" }, 409)).mockResolvedValueOnce(json(result));
    expect(await requestReplayAdvance({ fetch: send, url: "/sync", body: "fixed", signal: new AbortController().signal,
      onRetry: vi.fn(), wait: async () => undefined })).toEqual(result);
  });

  it("stops pending retries when the page unmounts", async () => {
    const lifetime = new AbortController();
    const send = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(requestReplayAdvance({ fetch: send, url: "/sync", body: "fixed", signal: lifetime.signal,
      onRetry: () => lifetime.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(waitForReplayRetry(100, lifetime.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not restore a checkpoint for stale or older responses", () => {
    const current = { currentSequence: 50, generation: 2 };
    for (const response of [{ currentSequence: 49, generation: 2 }, { currentSequence: 50, generation: 2 }, { currentSequence: 60, generation: 1 }]) {
      expect(() => assertForwardReplayResult(current, response)).toThrow();
      expect(current.currentSequence).toBe(50);
    }
  });

  it("retries transient chart reads but stops for changed source history", async () => {
    const read = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce("bars");
    expect(await retryReplayOperation(read, { signal: new AbortController().signal, onRetry: vi.fn(), wait: async () => undefined })).toBe("bars");
    const stale = vi.fn().mockRejectedValue(new HistoryVersionConflict("changed"));
    await expect(retryReplayOperation(stale, { signal: new AbortController().signal, onRetry: vi.fn() })).rejects.toThrow("changed");
    expect(stale).toHaveBeenCalledTimes(1);
  });
});
