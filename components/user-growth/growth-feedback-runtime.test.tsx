import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => {
  type EffectRecord = { deps?: readonly unknown[]; cleanup?: () => void };
  type PendingEffect = { index: number; effect: () => void | (() => void); deps?: readonly unknown[] };
  let cursor = 0;
  let slots: unknown[] = [];
  let effects: EffectRecord[] = [];
  let pending: PendingEffect[] = [];
  const same = (left?: readonly unknown[], right?: readonly unknown[]) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  return {
    reset() { cursor = 0; slots = []; effects = []; pending = []; },
    begin() { cursor = 0; pending = []; },
    useState<T>(initial: T): [T, (value: T | ((previous: T) => T)) => void] {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index] as T, value => { slots[index] = typeof value === "function" ? (value as (previous: T) => T)(slots[index] as T) : value; }];
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as { callback: T; deps: readonly unknown[] } | undefined;
      if (!previous || !same(previous.deps, deps)) slots[index] = { callback, deps };
      return (slots[index] as { callback: T }).callback;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || deps === undefined || !same(previous.deps, deps)) {
        pending.push({ index, effect, deps });
        effects[index] = { deps, cleanup: previous?.cleanup };
      }
    },
    flushEffects() {
      for (const item of pending) {
        effects[item.index]?.cleanup?.();
        const cleanup = item.effect();
        effects[item.index] = { deps: item.deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      }
      pending = [];
    },
  };
});

vi.mock("react", () => ({
  useCallback: hookHarness.useCallback,
  useEffect: hookHarness.useEffect,
  useRef: hookHarness.useRef,
  useState: hookHarness.useState,
}));

import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { useReplayAccountRuntime } from "@/lib/market-replay/use-replay-account-runtime";

beforeEach(() => { hookHarness.reset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function snapshot(sessionId: string, version: number, totalXp: number) {
  return { session: { id: sessionId }, growth: { userId: "user-a", nickname: "测试用户", totalXp, realmLabel: "凡人", version } } as unknown as PaperSessionSnapshot;
}

describe("growth settlement feedback runtime", () => {
  it("removes feedback after five seconds and resets the timer for an identical notice", () => {
    const setSnapshot = vi.fn();
    const useRuntime = (paperSnapshot: PaperSessionSnapshot | null = null) => {
      hookHarness.begin();
      const result = useReplayAccountRuntime(paperSnapshot, setSnapshot);
      hookHarness.flushEffects();
      return result;
    };
    let runtime = useRuntime();
    runtime.commitConfirmedPaperSnapshot(snapshot("session-a", 0, 0));
    runtime.commitConfirmedPaperSnapshot(snapshot("session-a", 1, 10));
    runtime = useRuntime(snapshot("session-a", 1, 10));
    const firstMessage = runtime.growthNotice;
    expect(firstMessage).toBeTruthy();
    expect(runtime.growthNoticeKey).toBe(1);

    vi.advanceTimersByTime(4500);
    runtime = useRuntime(snapshot("session-a", 1, 10));
    runtime.commitConfirmedPaperSnapshot(snapshot("session-a", 2, 20));
    runtime = useRuntime(snapshot("session-a", 2, 20));
    expect(runtime.growthNotice).toBe(firstMessage);
    expect(runtime.growthNoticeKey).toBe(2);

    vi.advanceTimersByTime(4999);
    runtime = useRuntime(snapshot("session-a", 2, 20));
    expect(runtime.growthNotice).toBe(firstMessage);
    vi.advanceTimersByTime(1);
    runtime = useRuntime(snapshot("session-a", 2, 20));
    expect(runtime.growthNotice).toBeNull();
  });

  it("clears feedback and its timer when the confirmed session changes", () => {
    const setSnapshot = vi.fn();
    const useRuntime = (paperSnapshot: PaperSessionSnapshot | null = null) => {
      hookHarness.begin();
      const result = useReplayAccountRuntime(paperSnapshot, setSnapshot);
      hookHarness.flushEffects();
      return result;
    };
    let runtime = useRuntime();
    runtime.commitConfirmedPaperSnapshot(snapshot("session-a", 0, 0));
    runtime.commitConfirmedPaperSnapshot(snapshot("session-a", 1, 10));
    runtime = useRuntime(snapshot("session-a", 1, 10));
    expect(runtime.growthNotice).toBeTruthy();

    runtime.commitConfirmedPaperSnapshot(snapshot("session-b", 1, 10));
    runtime = useRuntime(snapshot("session-b", 1, 10));
    expect(runtime.growthNotice).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
