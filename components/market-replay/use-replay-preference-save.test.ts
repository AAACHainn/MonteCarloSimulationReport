import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }) }));
import { useReplayPreferenceSave } from "./use-replay-preference-save";
import { createReplayState } from "@/lib/market-replay/engine";
import type { ReplayState } from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
const state = (rate: ReplayState["playbackRate"]) => createReplayState(240, 0, rate, 60);
function setup() {
  const responses: Array<(value: Response) => void> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(resolve => responses.push(resolve)));
  const core = { fetch, pendingSaveRef: { current: null as ReplayState | null }, saveTimerRef: { current: null as ReturnType<typeof setTimeout> | null }, lastSaveAtRef: { current: Date.now() }, saveChainRef: { current: Promise.resolve() }, setSaveStatus: vi.fn() };
  // React hooks are synchronous stubs in this isolated queue harness.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return { core, responses, ...useReplayPreferenceSave("fixture", core as unknown as Parameters<typeof useReplayPreferenceSave>[1]) };
}
afterEach(() => vi.useRealTimers());
describe("replay preference writes before account confirmation", () => {
  it("drains both in-flight and debounced writes before reading a confirmation version", async () => {
    vi.useFakeTimers(); const s = setup(); let version = 1;
    s.queueSave(state(2), true);
    await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(1));
    s.queueSave(state(3), false);
    const capture = vi.fn(() => version);
    const confirmation = s.flushPreferences().then(capture);
    expect(capture).not.toHaveBeenCalled();
    version++; s.responses[0](new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(2));
    expect(capture).not.toHaveBeenCalled();
    version++; s.responses[1](new Response(null, { status: 200 }));
    expect(await confirmation).toBe(3);
    await vi.runAllTimersAsync(); expect(s.core.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(s.core.fetch.mock.calls[1][1]!.body as string).playbackRate).toBe(3);
  });
  it("also awaits a write enqueued during the first drain", async () => {
    const s = setup(); s.queueSave(state(2), true); await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(1));
    const capture = vi.fn(); const confirmation = s.flushPreferences().then(capture);
    s.queueSave(state(4), true); s.responses[0](new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(2));
    expect(capture).not.toHaveBeenCalled(); s.responses[1](new Response(null, { status: 200 }));
    await confirmation; expect(capture).toHaveBeenCalledOnce();
  });
  it("does not replay an older failed draft over a newer queued save", async () => {
    const s = setup(); s.queueSave(state(2), true);
    await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(1));
    s.queueSave(state(6), true); const confirmation = s.flushPreferences();
    s.responses[0](new Response(null, { status: 503 }));
    await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(2));
    s.responses[1](new Response(null, { status: 200 })); await confirmation;
    expect(s.core.pendingSaveRef.current).toBeNull(); expect(s.core.fetch).toHaveBeenCalledTimes(2);
  });
  it("forgets a completed failure after the start/reset flow discards its draft", async () => {
    const s = setup(); s.queueSave(state(2), true);
    await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(1));
    s.responses[0](new Response(null, { status: 503 })); await s.core.saveChainRef.current;
    expect(s.core.pendingSaveRef.current).not.toBeNull();
    s.core.pendingSaveRef.current = null;
    await s.flushPreferences(); expect(s.core.fetch).toHaveBeenCalledTimes(1);
  });
  it("blocks confirmation on failure, keeps the latest draft and permits an explicit retry", async () => {
    const s = setup(); s.queueSave(state(2), true); await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(1)); s.queueSave(state(5), false);
    const confirmation = s.flushPreferences(); const rejected = expect(confirmation).rejects.toThrow(copy.marketReplay.saveError);
    s.responses[0](new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(2));
    s.responses[1](new Response(null, { status: 503 })); await rejected;
    expect(s.core.pendingSaveRef.current?.playbackRate).toBe(5);
    const retry = s.flushPreferences(); await vi.waitFor(() => expect(s.core.fetch).toHaveBeenCalledTimes(3));
    s.responses[2](new Response(null, { status: 200 })); await retry;
    expect(s.core.pendingSaveRef.current).toBeNull();
  });
});
