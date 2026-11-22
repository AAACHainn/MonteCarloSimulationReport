import { unlinkSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";
import { createSqliteFixture } from "./sqlite-test-fixture";

it("copies the current schema into independent writable SQLite databases", async () => {
  const files = [createSqliteFixture("sqlite-fixture"), createSqliteFixture("sqlite-fixture")];
  const databases = files.map(file => new PrismaClient({ datasourceUrl: `file:${file}` }));
  try {
    const [first, second] = databases;
    expect(files[0]).not.toBe(files[1]);
    expect(await first.$queryRaw`PRAGMA journal_mode`).toEqual([{ journal_mode: "delete" }]);
    expect(await first.achievementSyncState.findUnique({ where: { id: 1 } })).not.toBeNull();
    await first.$executeRaw`CREATE TABLE fixture_isolation (value INTEGER)`;
    expect(await second.$queryRaw`SELECT name FROM sqlite_master WHERE name = 'fixture_isolation'`).toEqual([]);
  } finally {
    await Promise.all(databases.map(db => db.$disconnect()));
    for (const file of files) unlinkSync(file);
  }
});
