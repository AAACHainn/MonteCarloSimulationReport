import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { checkIntegrity, fingerprint } from "./upgrade-sqlite.mjs";

const directory = mkdtempSync(join(tmpdir(), "user-profiles-migration-"));
const base = join(directory, "fresh.db");
const env = file => ({ ...process.env, DATABASE_URL: `file:${file.replaceAll("\\", "/")}`, SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", SQLITE_SYNCHRONOUS: "FULL", MARKET_DATA_SYNC_ENABLED: "0" });
const init = file => execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: env(file), windowsHide: true, stdio: "pipe" });
const columns = db => db.pragma('table_info("ReplaySession")').map(column => column.name);
function fixture() {
  const file = join(directory, `${randomUUID()}.db`); copyFileSync(base, file);
  const db = new Database(file);
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
describe("current user profiles initialization", () => {
  it("keeps existing owners, growth eligibility and all stored records on repeated initialization", () => {
    const { file, db } = fixture();
    db.exec(`INSERT INTO "UserProfile" (id,nickname,updatedAt) VALUES ('owner','已有用户',1000);
      INSERT INTO "UserGrowth" (userId,totalXp,updatedAt) VALUES ('owner',137,1000);
      INSERT INTO "ReplaySession" (id,datasetId,name,mode,userId,growthEligible,updatedAt) VALUES ('owned','data','已有个人会话','TRAINING','owner',true,1000);`);
    const before = fingerprint(db); expectFinalSchema(db); db.close();
    init(file); const initialized = new Database(file);
    let afterFirstInit;
    try {
      expectFinalSchema(initialized);
      const legacyTables = before.filter(table => !["UserWallet", "UserWalletEntry", "UserWalletAllocation"].includes(table.name));
      expect(fingerprint(initialized, legacyTables)).toEqual(legacyTables);
      expect(initialized.prepare('SELECT "balanceMinor" FROM "UserWallet" WHERE "userId"=?').get("owner")).toEqual({ balanceMinor: 1_000_000 });
      expect(initialized.prepare('SELECT "type", "amountMinor", "balanceAfterMinor" FROM "UserWalletEntry" WHERE "userId"=?').get("owner"))
        .toEqual({ type: "INITIAL", amountMinor: 1_000_000, balanceAfterMinor: 1_000_000 });
      afterFirstInit = fingerprint(initialized);
    } finally { initialized.close(); }
    init(file); const after = new Database(file);
    try { expectFinalSchema(after); expect(fingerprint(after)).toEqual(afterFirstInit); } finally { after.close(); }
  }, 30000);
});
