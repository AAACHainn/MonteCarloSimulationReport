import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void> }));
type EffectSlot = { deps: unknown[]; cleanup?: void | (() => void) };
vi.mock("react", () => ({
  createContext: () => ({ Provider: "test-provider" }),
  useContext: () => null,
  useRef: (initial: unknown) => { const slot = hooks.index++; if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial }; return hooks.slots[slot]; },
  useState: (initial: unknown) => { const slot = hooks.index++; if (!(slot in hooks.slots)) hooks.slots[slot] = initial; return [hooks.slots[slot], (value: unknown) => { hooks.slots[slot] = typeof value === "function" ? value(hooks.slots[slot]) : value; }]; },
  useCallback: (work: unknown, deps: unknown[]) => { const slot = hooks.index++, old = hooks.slots[slot] as { deps: unknown[]; work: unknown } | undefined; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) hooks.slots[slot] = { deps, work }; return (hooks.slots[slot] as { work: unknown }).work; },
  useEffect: (work: () => void | (() => void), deps: unknown[]) => {
    const slot = hooks.index++, old = hooks.slots[slot] as EffectSlot | undefined;
    if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) hooks.effects.push(() => { old?.cleanup?.(); hooks.slots[slot] = { deps, cleanup: work() }; });
  },
}));
import { CurrentUserProvider, USER_SELECTION_KEY } from "./user-context";
import type { UserIdentity } from "@/lib/user-growth/types";
import { copy } from "@/lib/i18n";
const user = (id: string): UserIdentity => ({ id, nickname: id, avatar: { preset: 0, zoom: 1, x: 50, y: 50 }, realmLabel: "凡人" });
let responders: Array<(response: Response) => void>;
let store: Map<string, string>;
beforeEach(() => {
  hooks.index = 0; hooks.slots = []; hooks.effects = []; responders = []; store = new Map();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("React", { createElement: (_type: unknown, props: unknown) => ({ props }) });
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => responders.push(resolve))));
});
afterEach(() => { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); vi.unstubAllGlobals(); });
function render() {
  hooks.index = 0; const result = CurrentUserProvider({ children: null }); hooks.effects.splice(0).forEach(work => work()); return result.props.value;
}
const respond = (index: number, ids: string[], status = 200) => responders[index](new Response(JSON.stringify({ users: ids.map(user) }), { status }));
describe("browser selection memory and stale responses", () => {
  it("starts globally when this browser has no saved selection", async () => {
    render(); expect(render().selectedId).toBeNull(); respond(0, ["a"]);
    await vi.waitFor(() => expect(render().state).toBe("normal")); expect(render().selectedId).toBeNull();
  });
  it("defaults to global and retains a known stored ID during network failures", async () => {
    store.set(USER_SELECTION_KEY, "a"); render(); expect(render().selectedId).toBe("a");
    respond(0, [], 503); await vi.waitFor(() => expect(render().state).toBe("error")); expect(render().selectedId).toBe("a");
    render().refresh(); respond(1, ["a", "b"]); await vi.waitFor(() => expect(render().selected?.nickname).toBe("a"));
  });
  it("only falls back after a successful authoritative missing-ID response", async () => {
    store.set(USER_SELECTION_KEY, "missing"); render(); respond(0, ["a"]);
    await vi.waitFor(() => expect(render().selectedId).toBeNull()); expect(render().notice).toBe(copy.userGrowth.selectionExpired); expect(store.has(USER_SELECTION_KEY)).toBe(false);
  });
  it("supports in-memory selection when all localStorage access throws", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    render(); respond(0, ["a", "b"]); await vi.waitFor(() => expect(render().state).toBe("normal"));
    render().select("b"); expect(render().selectedId).toBe("b"); expect(render().notice).toBe(copy.userGrowth.storageUnavailable);
    render().select(null); expect(render().selectedId).toBeNull();
  });
  it("ignores older list responses and responses started before a new profile was created", async () => {
    render(); render().refresh(); respond(1, ["a"]); await vi.waitFor(() => expect(render().users).toEqual([user("a")]));
    respond(0, ["old"]); await Promise.resolve(); await Promise.resolve(); expect(render().users).toEqual([user("a")]);
    render().refresh(); render().upsert(user("new")); render().select("new"); respond(2, ["a"]);
    await Promise.resolve(); await Promise.resolve(); expect(render().selectedId).toBe("new"); expect(render().users.some((item: UserIdentity) => item.id === "new")).toBe(true);
  });
  it("adopts other-tab selection and does not let an earlier response clear it", async () => {
    render(); respond(0, ["a", "b"]); await vi.waitFor(() => expect(render().state).toBe("normal"));
    render().select("a"); render().refresh();
    window.dispatchEvent(Object.assign(new Event("storage"), { key: USER_SELECTION_KEY, newValue: "b" }));
    respond(1, ["a"]); respond(2, ["a", "b"]); await vi.waitFor(() => expect(render().selectedId).toBe("b"));
    expect(store.get(USER_SELECTION_KEY)).toBe("a"); // event is already persisted by the other tab, no echo write
  });
});
