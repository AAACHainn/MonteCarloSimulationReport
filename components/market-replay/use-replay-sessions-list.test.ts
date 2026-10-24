import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReplaySessionsList } from "./use-replay-sessions-list";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void> }));
type EffectSlot = { deps: unknown[]; cleanup?: void | (() => void) };
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = hooks.index++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = initial;
    return [hooks.slots[slot], (value: unknown) => { hooks.slots[slot] = typeof value === "function" ? value(hooks.slots[slot]) : value; }];
  },
  useEffect: (work: () => void | (() => void), deps: unknown[]) => {
    const slot = hooks.index++, previous = hooks.slots[slot] as EffectSlot | undefined;
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) hooks.effects.push(() => {
      previous?.cleanup?.(); hooks.slots[slot] = { deps, cleanup: work() };
    });
  },
}));
const session = (received: number) => ({ id: "session", propAccount: { state: { totalReceived: received } } }) as ReplaySessionSummary;
const initial = [session(0)];
let responders: Array<(value: Response) => void>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  hooks.index = 0; hooks.slots = []; hooks.effects = []; responders = [];
  fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => responders.push(resolve)));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
});
afterEach(() => {
  for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
  vi.unstubAllGlobals();
});
function RenderHook(paused = false) {
  hooks.index = 0;
  const state = useReplaySessionsList("dataset", initial, paused);
  hooks.effects.splice(0).forEach(work => work());
  return state;
}
function respond(index: number, received: number) { responders[index](new Response(JSON.stringify({ sessions: [session(received)] }))); }

describe("session list revalidation", () => {
  it("replaces the cached payout amount immediately after entering the page", async () => {
    expect(RenderHook().sessions).toEqual(initial);
    expect(fetcher).toHaveBeenCalledWith("/api/market-datasets/dataset/replay-sessions", expect.objectContaining({ cache: "no-store" }));
    respond(0, 1710);
    await vi.waitFor(() => expect(RenderHook().sessions).toEqual([session(1710)]));
  });
  it("refreshes on focus, visibility and browser restoration; late requests cannot overwrite the latest list", async () => {
    RenderHook();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    respond(3, 1710); await vi.waitFor(() => expect(RenderHook().sessions).toEqual([session(1710)]));
    for (const index of [0, 1, 2]) respond(index, 0);
    await Promise.resolve(); await Promise.resolve();
    expect(RenderHook().sessions).toEqual([session(1710)]);
  });
  it("retains the previous list on failure and clears the refresh error after recovery", async () => {
    RenderHook(); responders[0](new Response(JSON.stringify({ error: "offline" }), { status: 503 }));
    await vi.waitFor(() => expect(RenderHook().error).toBe("offline"));
    expect(RenderHook().sessions).toEqual(initial);
    window.dispatchEvent(new Event("focus")); respond(1, 1710);
    await vi.waitFor(() => expect(RenderHook().error).toBeNull());
    expect(RenderHook().sessions).toEqual([session(1710)]);
  });
  it("pauses refreshes during mutations, cancels old reads and refreshes again after the mutation", async () => {
    RenderHook();
    const paused = RenderHook(true); paused.setSessions([session(1710)]);
    window.dispatchEvent(new Event("focus")); expect(fetcher).toHaveBeenCalledTimes(1);
    respond(0, 0); await Promise.resolve(); await Promise.resolve();
    expect(RenderHook(true).sessions).toEqual([session(1710)]);
    RenderHook(); expect(fetcher).toHaveBeenCalledTimes(2); respond(1, 2000);
    await vi.waitFor(() => expect(RenderHook().sessions).toEqual([session(2000)]));
  });
});
