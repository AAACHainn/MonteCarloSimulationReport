import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
const { isolatedDatabasePath, reportDirectory } = createRequire(import.meta.url)("./client.cjs") as {
  isolatedDatabasePath(url: unknown): string; reportDirectory: string;
};
describe("isolated SQLite validation database guard", () => {
  it("accepts the explicit integration fixture and copied database locations", () => {
    const fixture = join(tmpdir(), "sqlite-wal-benchmark-00000000-0000-0000-0000-000000000000.db");
    expect(isolatedDatabasePath("file:" + fixture)).toBe(fixture);
    const copy = join(reportDirectory, "run-1", "working.db");
    expect(isolatedDatabasePath("file:" + copy)).toBe(copy);
  });
  it.each([
    undefined, "file:./dev.db", "file:" + join(process.cwd(), "prisma/dev.db"),
    "file:" + join(tmpdir(), "dev.db"),
    "file:" + join(reportDirectory, "..", "live.db"),
    "file:" + join(reportDirectory + "-other", "live.db"),
    "file:" + join(reportDirectory, "working.db") + "?mode=ro",
  ])("refuses a missing, production, relative, escaping or parameterized URL: %s", url => {
    expect(() => isolatedDatabasePath(url)).toThrow();
  });
});
