import React from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pathname: "/users/a", push: vi.fn(), select: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => mocks.pathname }));
vi.mock("react", async () => ({ ...await vi.importActual("react"), useState: () => [false, vi.fn()] }));
vi.mock("./user-context", () => ({ useCurrentUser: () => ({ users: [], selectedId: "a", state: "normal", select: mocks.select }) }));
import { UserEntry } from "./user-entry";
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { mocks.push.mockClear(); mocks.select.mockClear(); });
function entry() { return UserEntry().props.children[0].props as { onSelect: (id: string | null) => void }; }
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
});
