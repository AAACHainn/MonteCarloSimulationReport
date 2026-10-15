import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuid } from "./uuid";

afterEach(() => vi.unstubAllGlobals());

describe("createUuid", () => {
  it("uses the native UUID generator when available, preserving its receiver", () => {
    const crypto = {
      randomUUID() {
        expect(this).toBe(crypto);
        return "a377aa59-6408-4f5b-9f5c-af9070c4749b";
      },
    };
    vi.stubGlobal("crypto", crypto);
    expect(createUuid()).toBe("a377aa59-6408-4f5b-9f5c-af9070c4749b");
  });

  it("generates distinct UUID v4 values without randomUUID, as on HTTP", () => {
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const ids = Array.from({ length: 1000 }, () => createUuid());
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
