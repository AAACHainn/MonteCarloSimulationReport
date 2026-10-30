import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { checkIntegrity, fingerprint } from "../../scripts/database/upgrade-sqlite.mjs";

const directory = mkdtempSync(join(tmpdir(), "user-profiles-migration-"));
const base = join(directory, "fresh.db");
const sql = readFileSync("prisma/migrations/20261025120000_user_profiles/migration.sql", "utf8");
const env = file => ({ ...process.env, DATABASE_URL: `file:${file.replaceAll("\\", "/")}`, SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", SQLITE_SYNCHRONOUS: "FULL", MARKET_DATA_SYNC_ENABLED: "0" });
const init = file => execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { env: env(file), windowsHide: true, stdio: "pipe" });
const columns = db => db.pragma('table_info("ReplaySession")').map(column => column.name);
function fixture(beforeUsers = false) {
  const file = join(directory, `${randomUUID()}.db`); copyFileSync(base, file);
  const db = new Database(file);
  if (beforeUsers) {
    db.pragma("foreign_keys=OFF");
    db.exec('DROP TABLE "UserRealmRecord"; DROP TABLE "UserGrowthFact"; DROP TABLE "UserGrowth"; DROP TABLE "UserProfile"; DROP INDEX "ReplaySession_userId_createdAt_idx"; ALTER TABLE "ReplaySession" DROP COLUMN "userId"; ALTER TABLE "ReplaySession" DROP COLUMN "growthEligible";');
  }
  db.pragma("foreign_keys=ON");
  db.exec(`INSERT INTO "MarketDataset" (id,name,symbol,timeframe,timezone,barCount,startTime,endTime,updatedAt) VALUES ('data','保留行情','TEST','1m','UTC',1,1000,1000,1000);
    INSERT INTO "ReplaySession" (id,datasetId,name,mode,updatedAt) VALUES ('global','data','原有会话','TRAINING',1000);`);
  return { file, db };
}
function expectFinalSchema(db) {
  expect(columns(db)).not.toContain("ownershipSource"); expect(columns(db)).not.toContain("assignedAt");
  expect(columns(db)).toEqual(expect.arrayContaining(["userId", "growthEligible"]));
  checkIntegrity(db);
}
beforeAll(() => init(base), 30000);
describe("legacy user profiles migration through v1.0", () => {
  it("initializes old databases directly to the final schema without changing existing data", () => {
    const { file, db } = fixture(true); const before = fingerprint(db); db.close();
    init(file); const after = new Database(file);
    try {
      expectFinalSchema(after); expect(fingerprint(after, before)).toEqual(before);
      expect(after.prepare('SELECT userId,growthEligible FROM ReplaySession WHERE id=?').get("global")).toEqual({ userId: null, growthEligible: 0 });
      expect(after.prepare('SELECT count(*) n FROM UserProfile').get().n).toBe(0);
    } finally { after.close(); }
  }, 30000);
  it("uses the same final columns and preserves prior data through the Prisma migration SQL", () => {
    const { db } = fixture(true);
    try {
      const before = fingerprint(db); db.transaction(() => db.exec(sql))();
      expectFinalSchema(db); expect(fingerprint(db, before)).toEqual(before);
      expect(db.pragma('foreign_key_list("ReplaySession")')).toEqual(expect.arrayContaining([expect.objectContaining({ from: "userId", table: "UserProfile", on_delete: "RESTRICT" })]));
      expect(db.prepare('SELECT userId,growthEligible FROM ReplaySession WHERE id=?').get("global")).toEqual({ userId: null, growthEligible: 0 });
    } finally { db.close(); }
  });
});
