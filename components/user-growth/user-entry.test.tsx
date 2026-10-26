import React from "react";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import type { UserIdentity } from "@/lib/user-growth/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pathname: "/users/a", push: vi.fn(), select: vi.fn(), current: { users: [] as Array<{ id: string; nickname: string; avatar: { preset: number; zoom: number; x: number; y: number }; realmLabel: string; growth?: { totalXp: number; realm: "mortal" | "qi" | "foundation"; segment?: { value: number; max: number; next: string } } }>, selectedId: "a", selected: undefined as unknown, state: "normal" as const, notice: "", refresh: vi.fn(), upsert: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => mocks.pathname }));
vi.mock("react", async () => ({ ...await vi.importActual("react"), useState: () => [false, vi.fn()] }));
vi.mock("./user-context", () => ({ useCurrentUser: () => ({ ...mocks.current, select: mocks.select }) }));
import { UserEntry } from "./user-entry";
import { OwnershipContext } from "./ownership-context";
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { mocks.push.mockClear(); mocks.select.mockClear(); });
function entry() { return UserEntry().props.children[0].props as { onSelect: (id: string | null) => void; compact: boolean; selected?: UserIdentity }; }
describe("explicit avatar selection navigation", () => {
  it("keeps direct profile viewing independent until the user explicitly switches", () => {
    mocks.pathname = "/users/a"; const selector = entry(); expect(mocks.push).not.toHaveBeenCalled();
    selector.onSelect("b"); expect(mocks.select).toHaveBeenCalledWith("b"); expect(mocks.push).toHaveBeenCalledWith("/users/b");
    selector.onSelect(null); expect(mocks.push).toHaveBeenLastCalledWith("/users");
  });
  it("does not navigate away from replay or other shared pages", () => {
    for (const path of ["/market-replay/fixture", "/market-replay/fixture/trade-history", "/users", "/datasets"]) {
      mocks.pathname = path; entry().onSelect("b");
    }
    expect(mocks.select).toHaveBeenCalledTimes(4); expect(mocks.push).not.toHaveBeenCalled();
  });
  it("passes the compact presentation option through to the selector", () => {
    expect(entry().compact).toBe(false);
    const compact = UserEntry({ compact: true }).props.children[0].props as { compact: boolean };
    expect(compact.compact).toBe(true);
  });
  it("passes session ownership as popover content instead of rendering it beside the trigger", () => {
    const session = { id: "session-a", name: "Sample session" } as ReplaySessionSummary;
    const selector = UserEntry({ compact: true, session }).props.children[0].props as { context: { type: unknown; props: { session: ReplaySessionSummary } }; allowSwitch: boolean };
    expect(selector.context.type).toBe(OwnershipContext);
    expect(selector.context.props.session).toBe(session); expect(selector.allowSwitch).toBe(false);
  });
  it("binds the avatar growth to the selected user or the session owner, never the unrelated selection", () => {
    const growth = { totalXp: 600, realm: "qi" as const, segment: { value: 200, max: 450, next: "炼气三层" } };
    const otherGrowth = { totalXp: 0, realm: "mortal" as const, segment: { value: 0, max: 100, next: "炼气一层" } };
    const selected = { id: "selected", nickname: "当前选择", avatar: { preset: 0, zoom: 1, x: 50, y: 50 }, realmLabel: "炼气二层", growth };
    const owner = { id: "owner", nickname: "会话归属者", avatar: { preset: 1, zoom: 1, x: 50, y: 50 }, realmLabel: "炼气二层", growth: otherGrowth };
    mocks.current = { ...mocks.current, users: [selected, owner], selectedId: selected.id, selected };
    expect(entry().selected!.growth).toBe(growth);

    const session = { id: "session-a", userId: owner.id, name: "Sample session", owner } as unknown as ReplaySessionSummary;
    expect(UserEntry({ compact: true, session }).props.children[0].props.selected.growth).toBe(otherGrowth);
  });
});
