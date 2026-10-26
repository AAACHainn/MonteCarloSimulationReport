import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const databaseFiles = new Set();
afterEach(() => {
  for (const file of databaseFiles) {
    rmSync(file, { force: true });
    databaseFiles.delete(file);
  }
});

describe("user wallet migration on an existing isolated SQLite database", () => {
  it("initializes existing profiles once, preserves existing records, and never refills a zero wallet", () => {
    const file = join(tmpdir(), `user-wallet-migration-${randomUUID()}.db`);
    const profileCreatedAt = "2025-01-02T03:04:05.000Z";
    databaseFiles.add(file);
    const db = new Database(file);
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE "UserProfile" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "nickname" TEXT NOT NULL UNIQUE,
          "avatar" TEXT NOT NULL DEFAULT 'DEFAULT',
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE "Trade" ("id" TEXT NOT NULL PRIMARY KEY, "note" TEXT NOT NULL);
        INSERT INTO "UserProfile" ("id", "nickname", "createdAt") VALUES ('existing-user', '既有用户', '${profileCreatedAt}');
        INSERT INTO "Trade" ("id", "note") VALUES ('existing-trade', 'must remain');
      `);
      const migration = readFileSync("prisma/migrations/20261026140000_user_wallet/migration.sql", "utf8");
      db.exec(migration);

      expect(db.prepare('SELECT "balanceMinor" FROM "UserWallet" WHERE "userId" = ?').get("existing-user")).toEqual({ balanceMinor: 1_000_000 });
      expect(db.prepare('SELECT "updatedAt" FROM "UserWallet" WHERE "userId" = ?').get("existing-user")).toEqual({ updatedAt: profileCreatedAt });
      expect(db.prepare('SELECT "type", "amountMinor", "balanceAfterMinor" FROM "UserWalletEntry" WHERE "userId" = ?').get("existing-user"))
        .toEqual({ type: "INITIAL", amountMinor: 1_000_000, balanceAfterMinor: 1_000_000 });
      expect(db.prepare('SELECT "createdAt" FROM "UserWalletEntry" WHERE "userId" = ?').get("existing-user")).toEqual({ createdAt: profileCreatedAt });
      expect(db.prepare('SELECT "note" FROM "Trade" WHERE "id" = ?').get("existing-trade")).toEqual({ note: "must remain" });

      db.prepare('UPDATE "UserWallet" SET "balanceMinor" = 0 WHERE "userId" = ?').run("existing-user");
      const initializationStatements = migration.replace(/^--.*$/gm, "").split(";").filter(statement => statement.trimStart().startsWith("INSERT OR IGNORE INTO"));
      for (const statement of initializationStatements) db.exec(`${statement};`);

      expect(db.prepare('SELECT "balanceMinor" FROM "UserWallet" WHERE "userId" = ?').get("existing-user")).toEqual({ balanceMinor: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM "UserWalletEntry" WHERE "userId" = ? AND "type" = \'INITIAL\'').get("existing-user"))
        .toEqual({ count: 1 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM "Trade"').get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});
