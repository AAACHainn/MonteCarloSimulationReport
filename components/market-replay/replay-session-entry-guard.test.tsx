import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => unknown>, selectedId: null as string | null, select: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useRef: (v: unknown) => { const i = rt.index++; if (!(i in rt.slots)) rt.slots[i] = { current: v }; return rt.slots[i]; },
    useState: (v: unknown) => { const i = rt.index++; if (!(i in rt.slots)) rt.slots[i] = v; return [rt.slots[i], (x: unknown) => { rt.slots[i] = x; }]; },
    useEffect: (f: () => unknown) => { rt.effects.push(f); }, useCallback: (f: unknown) => f };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: rt.push, refresh: rt.refresh }) }));
vi.mock("next/link", () => ({ default: "link" }));
vi.mock("@/components/user-growth/user-context", () => ({ useCurrentUser: () => ({ selectedId: rt.selectedId, hydrated: true, select: rt.select }) }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: "confirm" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/alert", () => ({ Alert: "alert", AlertDescription: "alert-description" }));
vi.mock("@/components/ui/card", () => ({ Card: "card", CardHeader: "header", CardTitle: "title", CardDescription: "description", CardContent: "card-content" }));
import { copy } from "@/lib/i18n";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { ReplaySessionGate, useReplaySessionEntry } from "./replay-session-entry-guard";

type E = { type: unknown; props: Record<string, unknown> };
function all(n: unknown): E[] { if (!n || typeof n !== "object") return []; if (Array.isArray(n)) return n.flatMap(all); const element = n as E; return [element, ...all(element.props.children)]; }
function useEntryHook() { rt.index = 0; return useReplaySessionEntry(); }
function session(id: string, userId: string | null, ownerId = userId, nickname = ownerId ?? ""): ReplaySessionSummary { return { id, datasetId: "ds", name: id, userId, owner: ownerId ? { id: ownerId, nickname } : null, activeProjectionId: "p", status: "ACTIVE" } as ReplaySessionSummary; }
function res(s: ReplaySessionSummary) { return { ok: true, json: async () => ({ session: s }) }; }
function dialog(ui: unknown) { return all(ui).find(e => e.type === "confirm")!.props as { open: boolean; onCancel: () => void; onConfirm: () => void; error: string }; }
function reset() { rt.index = 0; rt.slots = []; rt.effects = []; rt.selectedId = null; rt.select.mockReset(); rt.select.mockImplementation((id: string) => { rt.selectedId = id; }); rt.push.mockReset(); rt.refresh.mockReset(); }
beforeEach(() => { reset(); vi.stubGlobal("React", React); }); afterEach(() => vi.unstubAllGlobals());

describe("replay session entry guard", () => {
  it("cancel does not select owner, flush work, or navigate", async () => {
    const s = session("owned", "owner"), flush = vi.fn(async () => true), enter = vi.fn(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(s)));
    let entry = useEntryHook(); await entry.open({ sessionId: s.id, beforeEnter: flush, onEnter: enter }); entry = useEntryHook(); expect(dialog(entry.ui).open).toBe(true); dialog(entry.ui).onCancel();
    expect(rt.selectedId).toBeNull(); expect(rt.select).not.toHaveBeenCalled(); expect(flush).not.toHaveBeenCalled(); expect(enter).not.toHaveBeenCalled(); expect(rt.push).not.toHaveBeenCalled();
  });
  it("only flushes after consent, then selects the current owner and enters", async () => {
    const s = session("owned", "owner"), flush = vi.fn(async () => true), enter = vi.fn(), fetchMock = vi.fn().mockResolvedValue(res(s)); vi.stubGlobal("fetch", fetchMock);
    let entry = useEntryHook(); await entry.open({ sessionId: s.id, beforeEnter: flush, onEnter: enter }); expect(flush).not.toHaveBeenCalled(); entry = useEntryHook(); dialog(entry.ui).onConfirm();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); await Promise.resolve(); expect(flush).toHaveBeenCalledOnce(); await vi.waitFor(() => expect(rt.select).toHaveBeenCalledWith("owner")); expect(enter).toHaveBeenCalledWith(s);
  });
  it("requires a second consent when owner changes during confirmation", async () => {
    const a = session("owned", "a", "a", "Alpha"), b = session("owned", "b", "b", "Beta"), f = vi.fn().mockResolvedValueOnce(res(a)).mockResolvedValueOnce(res(b)).mockResolvedValue(res(b)); vi.stubGlobal("fetch", f);
    let entry = useEntryHook(); await entry.open({ sessionId: a.id }); entry = useEntryHook(); dialog(entry.ui).onConfirm(); await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2)); await Promise.resolve(); entry = useEntryHook();
    expect(dialog(entry.ui).error).toBe(copy.userGrowth.entryOwnerChanged); expect(rt.select).not.toHaveBeenCalled(); dialog(entry.ui).onConfirm(); await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(3)); await vi.waitFor(() => expect(rt.select).toHaveBeenCalledWith("b"));
  });
  it("ignores a stale response after a newer open request", async () => {
    const a = session("a", null), b = session("b", null); let resolveA!: (v: ReturnType<typeof res>) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/a") ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(res(b))));
    const onA = vi.fn(), onB = vi.fn(); let entry = useEntryHook(); const old = entry.open({ sessionId: "a", onEnter: onA }); entry = useEntryHook(); await entry.open({ sessionId: "b", onEnter: onB }); resolveA(res(a)); await old;
    expect(onA).not.toHaveBeenCalled(); expect(onB).toHaveBeenCalledWith(b); expect(rt.select).not.toHaveBeenCalled();
  });
  it("keeps direct URL replay children unmounted until consent", async () => {
    const s = session("owned", "owner"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(s)));
    rt.index = 0; let tree = ReplaySessionGate({ session: s, children: React.createElement("span", { id: "replay" }) }); rt.effects.splice(0).forEach(f => f());
    await vi.waitFor(() => { rt.index = 0; tree = ReplaySessionGate({ session: s, children: React.createElement("span", { id: "replay" }) }); expect(dialog(tree).open).toBe(true); }); expect(all(tree).some(e => e.props.id === "replay")).toBe(false); dialog(tree).onConfirm();
    await vi.waitFor(() => expect(rt.select).toHaveBeenCalledWith("owner")); rt.index = 0; tree = ReplaySessionGate({ session: s, children: React.createElement("span", { id: "replay" }) }); expect(all(tree).some(e => e.props.id === "replay")).toBe(true);
  });
});

describe("entry guard edge cases", () => {
  it.each(["same-owner", "unassigned"])("enters %s sessions without changing user selection", async kind => {
    const s = kind === "same-owner" ? session("same", "owner") : session("unassigned", null);
    rt.selectedId = kind === "same-owner" ? "owner" : null;
    const enter = vi.fn(), flush = vi.fn(async () => true); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(s)));
    const entry = useEntryHook(); await entry.open({ sessionId: s.id, beforeEnter: flush, onEnter: enter });
    expect(rt.select).not.toHaveBeenCalled(); expect(flush).toHaveBeenCalledOnce(); expect(enter).toHaveBeenCalledWith(s);
  });
  it("shows fetch errors and does not enter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "session unavailable" }) }));
    const enter = vi.fn(); let entry = useEntryHook(); await entry.open({ sessionId: "missing", onEnter: enter }); entry = useEntryHook();
    expect(entry.error).toBe("session unavailable"); expect(enter).not.toHaveBeenCalled(); expect(rt.select).not.toHaveBeenCalled();
  });
  it("does not select or navigate when pending work refuses to flush", async () => {
    const s = session("same", "owner"); rt.selectedId = "owner"; vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(s)));
    const entry = useEntryHook(); const onEnter = vi.fn(); await entry.open({ sessionId: s.id, beforeEnter: async () => false, onEnter });
    expect(rt.select).not.toHaveBeenCalled(); expect(onEnter).not.toHaveBeenCalled(); expect(rt.push).not.toHaveBeenCalled();
  });
  it("ignores a response arriving after the gate unmount cleanup", async () => {
    const s = session("late", null); let resolve!: (value: ReturnType<typeof res>) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(r => { resolve = r; })));
    const entered = vi.fn(), entry = useEntryHook(); const pending = entry.open({ sessionId: s.id, onEnter: entered });
    const effect = rt.effects.splice(0).at(-1)!; const cleanup = effect() as unknown as () => void; cleanup(); resolve(res(s)); await pending;
    expect(entered).not.toHaveBeenCalled(); expect(rt.push).not.toHaveBeenCalled();
  });
  it("refreshes a direct URL gate when fetched ownership differs from server props", async () => {
    const stale = session("owned", null), fresh = session("owned", "owner"); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(res(fresh)).mockResolvedValue(res(fresh)));
    rt.index = 0; let tree = ReplaySessionGate({ session: stale, children: React.createElement("span", { id: "replay" }) }); rt.effects.splice(0).forEach(f => f());
    await vi.waitFor(() => { rt.index = 0; tree = ReplaySessionGate({ session: stale, children: React.createElement("span", { id: "replay" }) }); expect(dialog(tree).open).toBe(true); });
    dialog(tree).onConfirm(); await vi.waitFor(() => expect(rt.refresh).toHaveBeenCalledOnce());
  });
});
