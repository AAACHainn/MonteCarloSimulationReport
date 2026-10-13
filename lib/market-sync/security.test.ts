import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOrigin, decryptKey, encryptKey } from "./security";
afterEach(() => vi.unstubAllEnvs());
describe("market data credentials", () => {
  it("round trips encrypted credentials without storing plaintext and rejects tampering", () => {
    vi.stubEnv("MARKET_DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const value = encryptKey("test-databento-private-key"); expect(value).not.toContain("test-databento");
    expect(decryptKey(value)).toBe("test-databento-private-key");
    expect(() => decryptKey(value.slice(0, -4) + "AAAA")).toThrow();
  });
  it("requires a stable 32 byte master key", () => { vi.stubEnv("MARKET_DATA_ENCRYPTION_KEY", "invalid"); expect(() => encryptKey("secret")).toThrow(); });
  it("rejects cross origin and absent browser origin", () => {
    expect(() => assertSameOrigin(new Request("https://example.com/api/key", { method: "PUT", headers: { Origin: "https://attacker.com" } }))).toThrow();
    expect(() => assertSameOrigin(new Request("https://example.com/api/key", { method: "PUT" }))).toThrow();
    expect(() => assertSameOrigin(new Request("https://example.com/api/key", { method: "PUT", headers: { Origin: "https://example.com" } }))).not.toThrow();
  });
});
