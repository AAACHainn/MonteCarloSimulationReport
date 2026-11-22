import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AchievementNotice } from "./notice";

const hooks = vi.hoisted(() => ({
  anchor: { current: null as unknown as HTMLElement },
  effect: vi.fn<(setup: () => () => void) => void>(),
  show: vi.fn(),
}));

vi.mock("react", async () => ({
  ...await vi.importActual("react"),
  useRef: () => hooks.anchor,
  useState: () => [[], hooks.show],
  useEffect: hooks.effect,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("achievement notification receipts", () => {
  it("leaves the receipt available when the fetching header becomes hidden", async () => {
    vi.useFakeTimers();
    let receipt = "3";
    const saveReceipt = vi.fn((_key: string, value: string) => { receipt = value; });
    vi.stubGlobal("React", React);
    vi.stubGlobal("document", { hidden: false });
    vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
    vi.stubGlobal("localStorage", { getItem: () => receipt, setItem: saveReceipt });
    const feed = { user: { id: "user", nickname: "测试用户" }, latest: 4, count: 1, historical: 0 };
    let completeRequest!: (response: Response) => void;
    const fetchFeed = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { completeRequest = resolve; }))
      .mockImplementation(() => Promise.resolve(Response.json(feed)));
    vi.stubGlobal("fetch", fetchFeed);
    function mount(visible: () => boolean) {
      hooks.anchor = { current: { getClientRects: () => visible() ? [{}] : [] } as unknown as HTMLElement };
      AchievementNotice({ userId: "user", href: "/users/user/achievements" });
      return hooks.effect.mock.calls.at(-1)![0]();
    }

    let regularVisible = true;
    const closeRegular = mount(() => regularVisible);
    regularVisible = false;
    completeRequest(Response.json(feed));
    await vi.advanceTimersByTimeAsync(0);
    expect(saveReceipt).not.toHaveBeenCalled();
    expect(hooks.show).not.toHaveBeenCalled();

    const closeFullscreen = mount(() => true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFeed.mock.calls.map(([url]) => url)).toEqual([
      "/api/users/user/achievements/notifications?after=3",
      "/api/users/user/achievements/notifications?after=3",
    ]);
    expect(saveReceipt).toHaveBeenCalledTimes(1);
    expect(saveReceipt).toHaveBeenCalledWith("achievements.receipt.v1.user", "4");
    expect(hooks.show).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(hooks.show).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(hooks.show).toHaveBeenLastCalledWith([]);
    closeFullscreen();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    closeRegular();
  });
});
