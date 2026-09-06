import { describe, expect, it } from "vitest";
import { createDeterministicEventIdFactory } from "./deterministic-id";

describe("deterministic replay event ids", () => {
  it("recreates the same ordered ids for one source bar", () => {
    const first = createDeterministicEventIdFactory("session", 3, 42);
    const second = createDeterministicEventIdFactory("session", 3, 42);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("isolates replay generations and source sequences", () => {
    const values = [
      createDeterministicEventIdFactory("session", 1, 42)(),
      createDeterministicEventIdFactory("session", 2, 42)(),
      createDeterministicEventIdFactory("session", 1, 43)(),
    ];
    expect(new Set(values).size).toBe(3);
  });
});
