import { describe, expect, it } from "vitest";
import { isSafeArchivePath } from "./backup";

describe("isSafeArchivePath", () => {
  it("accepts screenshot paths inside the archive", () => {
    expect(isSafeArchivePath("screenshots/trade-1.png")).toBe(true);
  });

  it("rejects traversal paths", () => {
    expect(isSafeArchivePath("../outside.png")).toBe(false);
    expect(isSafeArchivePath("screenshots/../../outside.png")).toBe(false);
    expect(isSafeArchivePath("C:\\outside.png")).toBe(false);
  });
});
