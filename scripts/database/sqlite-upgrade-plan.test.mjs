import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyBaselineMigrations, identifyMigration, localMigrations } from "./sqlite-upgrade-plan.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseline = "20261026170000_user_wallet_transfers";
const pane = "20261120120000_market_drawing_pane";
const migrations = localMigrations(root);
const baselineMigrations = migrations.filter(({ name }) => name <= baseline);
let db;

function createBaseline(transformSql = sql => sql) {
  db = new Database(":memory:");
  for (const { name } of baselineMigrations) {
    const sql = readFileSync(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    db.exec(transformSql(sql, name));
  }
  return db;
}

afterEach(() => db?.close());

describe("upgrade planning for v1.0 databases", () => {
  it("keeps the old initializer layout, additional columns and data across repeated upgrades", () => {
    createBaseline((sql, name) => {
      if (name === "20260530110000_add_trade_journals") {
        return sql.replace(/,\s*CONSTRAINT "Trade_(?:instrument|strategy)OptionId_fkey"[^,\r\n]*/g, "");
      }
      if (name === "20260829090000_add_market_replay") {
        return sql.replace('"name" TEXT NOT NULL,\n    "description" TEXT,', `"description" TEXT,\n    "name" TEXT NOT NULL DEFAULT '回放会话',`);
      }
      return sql;
    });
    db.exec(`
      ALTER TABLE "MarketDrawing" ADD COLUMN "legacyLabel" TEXT;
      ALTER TABLE "MarketDrawing" ADD COLUMN "legacyRank" INTEGER NOT NULL DEFAULT 3;
      CREATE INDEX "legacyDrawingLabel" ON "MarketDrawing"("legacyLabel");
      CREATE TABLE "sqliteLegacyNotes" ("message" TEXT);
      INSERT INTO "sqliteLegacyNotes" VALUES ('keep this');
      INSERT INTO "MarketDataset" (id,symbol,timeframe,timezone,barCount,startTime,endTime,updatedAt)
        VALUES ('data','TEST','1m','UTC',1,1000,1000,1000);
      INSERT INTO "MarketDrawing" (id,datasetId,type,geometry,style,updatedAt,legacyLabel)
        VALUES ('drawing','data','line','{}','{}',1000,'original');
    `);
    expect(identifyMigration(db, root)).toMatchObject({ method: "baseline", pending: [pane] });
    applyBaselineMigrations(db, root);
    expect(identifyMigration(db, root).pending).toEqual([]);
    applyBaselineMigrations(db, root);
    expect(db.prepare('SELECT pane, legacyLabel, legacyRank FROM "MarketDrawing"').get())
      .toEqual({ pane: 1, legacyLabel: "original", legacyRank: 3 });
    expect(db.prepare('SELECT message FROM "sqliteLegacyNotes"').get().message).toBe("keep this");
    expect(db.prepare('SELECT * FROM "_replay_schema_migrations"').all()).toEqual(migrations.filter(({ name }) => name === pane));
    expect(() => db.prepare('UPDATE "MarketDrawing" SET pane = 6').run()).toThrow(/CHECK constraint failed/);
  });

  it.each([
    ['ALTER TABLE "Trade" DROP COLUMN "note"', "Trade.note"],
    ['DROP INDEX "TradeTag_normalizedName_key"', "TradeTag.TradeTag_normalizedName_key"],
    ['DROP INDEX "TradeTag_normalizedName_key"; CREATE INDEX "TradeTag_normalizedName_key" ON "TradeTag" ("normalizedName")', "TradeTag.TradeTag_normalizedName_key"],
    ['DROP INDEX "_TradeToTradeTag_AB_unique"; CREATE UNIQUE INDEX "_TradeToTradeTag_AB_unique" ON "_TradeToTradeTag" ("B","A")', "_TradeToTradeTag._TradeToTradeTag_AB_unique"],
    ['ALTER TABLE "Trade" ADD COLUMN "legacyRequired" TEXT NOT NULL', "Trade.legacyRequired"],
  ])("rejects incompatible definitions after %s", (sql, object) => {
    createBaseline().exec(sql);
    expect(() => identifyMigration(db, root)).toThrow(object);
  });

  it("still requires the baseline CHECK constraints", () => {
    createBaseline(sql => sql.replace('CHECK ("balanceMinor" >= 0)', ""));
    expect(() => identifyMigration(db, root)).toThrow(/UserWallet.*CHECK/);
  });

  it("still rejects drift and invalid checksums on the Prisma migration path", () => {
    createBaseline().exec('CREATE TABLE "_prisma_migrations" (migration_name, checksum, finished_at, rolled_back_at)');
    const record = db.prepare('INSERT INTO "_prisma_migrations" VALUES (?, ?, 1, NULL)');
    for (const { name, checksum } of baselineMigrations) record.run(name, checksum);
    expect(identifyMigration(db, root)).toMatchObject({ method: "prisma", pending: [pane] });
    db.exec('ALTER TABLE "Trade" ADD COLUMN "legacyNote" TEXT');
    expect(() => identifyMigration(db, root)).toThrow("数据库结构与迁移历史不符");
    db.prepare('UPDATE "_prisma_migrations" SET checksum = ? WHERE migration_name = ?').run("invalid", baseline);
    expect(() => identifyMigration(db, root)).toThrow("校验和不符");
  });
});
