import { describe, expect, it } from "vitest";
import { createReplayStepQueue } from "./step-queue";
import { createReplayStepShortcut, type ReplayShortcutPlatform } from "./keyboard-shortcuts";

function stepKey(repeat = false, platform: ReplayShortcutPlatform = "windows") {
  return { key: "ArrowRight", code: "ArrowRight", repeat, ctrlKey: platform === "windows", metaKey: platform === "mac",
    altKey: false, shiftKey: false, isComposing: false, defaultPrevented: false };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("manual replay step queue", () => {
  it("executes rapid clicks once each using the latest committed sequence", async () => {
    const queue = createReplayStepQueue();
    let sequence = -1;
    let inFlight = 0;
    const expected: number[] = [];
    await Promise.all(Array.from({ length: 30 }, () => queue.enqueue(async () => {
      expect(inFlight++).toBe(0);
      expected.push(sequence);
      await Promise.resolve();
      sequence += 300;
      inFlight--;
    })));
    expect(expected).toEqual(Array.from({ length: 30 }, (_, i) => i * 300 - 1));
    expect(sequence).toBe(8999);
  });

  it("cancels waiting clicks on a reset or interval change", async () => {
    const queue = createReplayStepQueue();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const first = queue.enqueue(async () => { calls.push("running"); await blocked; });
    await Promise.resolve();
    const second = queue.enqueue(async () => { calls.push("old interval"); });
    queue.cancel();
    const third = queue.enqueue(async () => { calls.push("new interval"); });
    release();
    await Promise.all([first, second, third]);
    expect(calls).toEqual(["running", "new interval"]);
  });

  it("lets active asynchronous work observe cancellation", async () => {
    const queue = createReplayStepQueue();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const states: boolean[] = [];
    const running = queue.enqueue(async (isCancelled) => {
      states.push(isCancelled());
      await blocked;
      states.push(isCancelled());
    });
    await Promise.resolve();
    queue.cancel();
    release();
    await running;
    expect(states).toEqual([false, true]);
  });

  it("drops queued clicks after a failure and accepts the next user attempt", async () => {
    const queue = createReplayStepQueue();
    let calls = 0;
    await Promise.all([
      queue.enqueue(async () => { throw new Error("offline"); }),
      queue.enqueue(async () => { calls++; }),
    ]);
    expect(calls).toBe(0);
    await queue.enqueue(async () => { calls++; });
    expect(calls).toBe(1);
  });

  it("retains a single physical press released before its queued step starts", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    const sync = deferred();
    const blocker = queue.enqueue(async () => { await sync.promise; });
    const calls: number[] = [];
    const tap = queue.enqueue(async () => { calls.push(1); }, shortcut.keyDown(stepKey(), "windows")!);
    shortcut.keyUp({ key: "ArrowRight" }, "windows");
    sync.resolve();
    await Promise.all([blocker, tap]);
    expect(calls).toEqual([1]);
  });

  it("retains the first press waiting for slow sync and skips its queued key repeats on release", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    const sync = deferred(), started = deferred();
    let sequence = 0;
    const first = queue.enqueue(async (isCancelled) => {
      started.resolve(); await sync.promise;
      expect(isCancelled()).toBe(false);
      sequence++;
    }, shortcut.keyDown(stepKey(), "windows")!);
    await started.promise;
    const repeats = Array.from({ length: 30 }, () => queue.enqueue(async () => { sequence++; }, shortcut.keyDown(stepKey(true), "windows")!));
    shortcut.keyUp({ key: "ArrowRight" }, "windows");
    sync.resolve();
    await Promise.all([first, ...repeats]);
    expect(sequence).toBe(1);
  });

  it("finishes the in-flight repeat as one complete display candle and skips later repeats", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    const sync = deferred(), started = deferred();
    let sequence = 0;
    await queue.enqueue(async () => { sequence += 300; }, shortcut.keyDown(stepKey(), "windows")!);
    const running = queue.enqueue(async (isCancelled) => {
      sequence += 100;
      started.resolve(); await sync.promise;
      for (let chunk = 0; chunk < 2; chunk++) {
        expect(isCancelled()).toBe(false);
        sequence += 100;
        await Promise.resolve();
      }
    }, shortcut.keyDown(stepKey(true), "windows")!);
    await started.promise;
    const waiting = queue.enqueue(async () => { sequence += 300; }, shortcut.keyDown(stepKey(true), "windows")!);
    shortcut.keyUp({ key: "ArrowRight" }, "windows");
    sync.resolve();
    await Promise.all([running, waiting]);
    expect(sequence).toBe(600);
  });

  it("preserves mouse clicks and each rapid physical tap while discarding long-press repeats", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    const sync = deferred();
    const operations = [queue.enqueue(async () => { await sync.promise; })];
    const calls: string[] = [];
    operations.push(queue.enqueue(async () => { calls.push("first press"); }, shortcut.keyDown(stepKey(), "windows")!));
    operations.push(queue.enqueue(async () => { calls.push("repeat"); }, shortcut.keyDown(stepKey(true), "windows")!));
    operations.push(queue.enqueue(async () => { calls.push("mouse"); }));
    shortcut.keyUp({ key: "ArrowRight" }, "windows");
    for (let tap = 0; tap < 5; tap++) {
      operations.push(queue.enqueue(async () => { calls.push(`tap ${tap}`); }, shortcut.keyDown(stepKey(), "windows")!));
      shortcut.keyUp({ key: "ArrowRight" }, "windows");
    }
    sync.resolve(); await Promise.all(operations);
    expect(calls).toEqual(["first press", "mouse", "tap 0", "tap 1", "tap 2", "tap 3", "tap 4"]);
  });

  it.each(["windows", "mac"] as const)("stops pending repeats when the %s shortcut modifier is released", async (platform) => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    let calls = 0;
    const first = queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(false, platform), platform)!);
    const repeat = queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(true, platform), platform)!);
    shortcut.keyUp({ key: platform === "mac" ? "Meta" : "Control" }, platform);
    expect(shortcut.keyDown(stepKey(true, platform), platform)).toBeNull();
    await Promise.all([first, repeat]);
    expect(calls).toBe(1);
  });

  it("runs repeats while held and does not stop them for unrelated key releases", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    let calls = 0;
    await queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(), "windows")!);
    shortcut.keyUp({ key: "a" }, "windows");
    await queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(true), "windows")!);
    await queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(true), "windows")!);
    expect(calls).toBe(3);
  });

  it("keeps a new hold independent of repeats captured before a release", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    const calls: string[] = [];
    const firstStart = shortcut.keyDown(stepKey(), "windows")!;
    const oldRepeatStart = shortcut.keyDown(stepKey(true), "windows")!;
    shortcut.keyUp({ key: "ArrowRight" }, "windows");
    const secondStart = shortcut.keyDown(stepKey(), "windows")!;
    const newRepeatStart = shortcut.keyDown(stepKey(true), "windows")!;
    // Delayed return-to-live work can enqueue an old repeat after keyup or even a new press.
    await Promise.all([
      queue.enqueue(async () => { calls.push("first press"); }, firstStart),
      queue.enqueue(async () => { calls.push("old repeat"); }, oldRepeatStart),
      queue.enqueue(async () => { calls.push("second press"); }, secondStart),
      queue.enqueue(async () => { calls.push("new repeat"); }, newRepeatStart),
    ]);
    expect(calls).toEqual(["first press", "second press", "new repeat"]);
  });

  it("releases waiting repeats on blur or cleanup without cancelling the physical press", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    let calls = 0;
    const first = queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(), "windows")!);
    const repeat = queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(true), "windows")!);
    shortcut.release();
    expect(shortcut.keyDown(stepKey(true), "windows")).toBeNull();
    await Promise.all([first, repeat]);
    expect(calls).toBe(1);
  });

  it("still cancels physical presses on an explicit replay reset", async () => {
    const queue = createReplayStepQueue(), shortcut = createReplayStepShortcut();
    let calls = 0;
    const first = queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(), "windows")!);
    const repeat = queue.enqueue(async () => { calls++; }, shortcut.keyDown(stepKey(true), "windows")!);
    queue.cancel(); await Promise.all([first, repeat]);
    expect(calls).toBe(0);
  });

  it("ignores unrelated or blocked shortcuts instead of creating a held repeat session", () => {
    const shortcut = createReplayStepShortcut();
    for (const event of [
      { ...stepKey(), ctrlKey: false }, { ...stepKey(), key: "ArrowDown" },
      { ...stepKey(), shiftKey: true }, { ...stepKey(), defaultPrevented: true }, { ...stepKey(), isComposing: true },
    ]) expect(shortcut.keyDown(event, "windows")).toBeNull();
    expect(shortcut.keyDown(stepKey(true), "windows")).toBeNull();
  });
});
