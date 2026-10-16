import { describe, expect, it } from "vitest";
import { createDeterministicEventIdFactory } from "./deterministic-id";
import { paperOrderUrl } from "./order-url";

describe("paper order request URLs", () => {
  it.each(["stop", "target"])("preserves a generated %s order id through route decoding", (kind) => {
    const orderId = createDeterministicEventIdFactory("account", 1, 42)(`${kind}:entry`);
    const url = new URL(paperOrderUrl("dataset", orderId), "http://localhost");

    // Next.js decodes each dynamic path segment once before passing route params.
    expect(decodeURIComponent(url.pathname.split("/").at(-1)!)).toBe(orderId);
  });

  it("keeps ordinary submitted order ids compatible", () => {
    expect(paperOrderUrl("dataset", "entry-order")).toBe("/api/market-datasets/dataset/paper-session/orders/entry-order");
  });
});
