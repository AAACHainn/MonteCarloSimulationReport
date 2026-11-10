import { describe, expect, it, vi } from "vitest";
import { useReplayActions } from "./use-replay-actions";

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
}));

function setup(confirmAction: "reset" | "paper-clear", flushNudges: () => Promise<boolean>) {
  const core = {
    confirmAction,
    dataset: { id: "fixture" },
    fetch: vi.fn(async () => new Response(JSON.stringify({ replaySessionId: "new-session" }))),
    router: { push: vi.fn() },
    latestReplayRef: { current: {} },
    wantsPlayback: () => false,
    manualStepsRef: { current: { cancel: vi.fn() } },
    advanceCompletionRef: { current: Promise.resolve() },
    confirmationSuspensionRef: { current: "suspended" },
    windowRequestRef: { current: 0 },
    saveTimerRef: { current: null },
    pendingSaveRef: { current: null },
    saveChainRef: { current: Promise.resolve() },
    pausePlayback: vi.fn(),
    restorePlayback: vi.fn(),
    setConfirmAction: vi.fn(),
    setStartDialogBusy: vi.fn(),
    setStartError: vi.fn(),
  };
  const engine = { flushVisible: vi.fn(async () => true), startReplayAt: vi.fn(async () => true) };
  // Exercise the action callbacks without mounting the full replay workspace.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const actions = useReplayActions(core as unknown as Parameters<typeof useReplayActions>[0],
    {} as Parameters<typeof useReplayActions>[1], engine as unknown as Parameters<typeof useReplayActions>[2], flushNudges);
  return { actions, core, engine };
}

describe("replay session changes with pending drawing nudges", () => {
  it.each([
    ["reset", "/api/market-datasets/fixture/replay/reset", "POST"],
    ["paper-clear", "/api/market-datasets/fixture/paper-session", "DELETE"],
  ] as const)("waits for drawing saves before %s and ignores a second confirmation", async (action, url, method) => {
    let complete!: (saved: boolean) => void;
    const flushNudges = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
    const { actions, core } = setup(action, flushNudges);
    const transition = actions.applyConfirmedAction();
    await vi.waitFor(() => expect(flushNudges).toHaveBeenCalledOnce());
    await actions.applyConfirmedAction();
    expect(flushNudges).toHaveBeenCalledOnce();
    expect(core.fetch).not.toHaveBeenCalled();
    expect(core.router.push).not.toHaveBeenCalled();
    complete(true);
    await transition;
    expect(core.fetch).toHaveBeenCalledOnce();
    expect(core.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method }));
    expect(core.router.push).toHaveBeenCalledOnce();
  });

  it.each(["reset", "paper-clear"] as const)("stays in the current session when a drawing save fails before %s", async action => {
    const { actions, core, engine } = setup(action, async () => false);
    await actions.applyConfirmedAction();
    expect(engine.flushVisible).not.toHaveBeenCalled();
    expect(core.fetch).not.toHaveBeenCalled();
    expect(core.router.push).not.toHaveBeenCalled();
    expect(core.restorePlayback).toHaveBeenCalledWith("suspended");
    expect(core.setConfirmAction).toHaveBeenCalledWith(null);
  });

  it("preserves the chosen start date for retry when a pending drawing save fails", async () => {
    const { actions, core, engine } = setup("reset", async () => false);
    await actions.applyNewReplayStart("2026-11-10T09:30");
    expect(engine.startReplayAt).not.toHaveBeenCalled();
    expect(core.setStartError).toHaveBeenCalledWith(expect.stringContaining("绘图微调"));
    expect(core.setStartDialogBusy).toHaveBeenLastCalledWith(false);
  });
});
