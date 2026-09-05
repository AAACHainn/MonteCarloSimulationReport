import { describe, expect, it } from "vitest";
import { createReplayStepQueue } from "./step-queue";

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
});
