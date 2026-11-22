import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkBaselineStructure } from "./sqlite-baseline-structure.mjs";

const baseline = "20261026170000_user_wallet_transfers";
const paneMigration = "20261120120000_market_drawing_pane";
export const achievementsMigration = "20261122120000_achievements";
const legacyVersions = new Set([baseline, paneMigration, achievementsMigration]);
const legacyHistory = "_replay_schema_migrations";
const hash = input => createHash("sha256").update(input).digest("hex");
const sqlFor = (root, name) => readFileSync(join(root, "prisma/migrations", name, "migration.sql"), "utf8");
const normalize = sql => sql?.replace(/\s+/g, " ").trim();
export const schemaObjects = db => db.prepare(
  "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND tbl_name NOT IN (?,?) ORDER BY type,name",
).all("_prisma_migrations", legacyHistory).map(row => ({ ...row, sql: normalize(row.sql) }));
export const localMigrations = root => readdirSync(join(root, "prisma/migrations"))
  .filter(name => existsSync(join(root, "prisma/migrations", name, "migration.sql"))).sort()
  .map(name => ({ name, checksum: hash(sqlFor(root, name)) }));

function hasTable(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function checksumMatches(root, name, checksum) {
  const lf = sqlFor(root, name).replaceAll("\r\n", "\n");
  return [hash(lf), hash(lf.replaceAll("\n", "\r\n"))].includes(checksum);
}

function compareWithMigrations(root, migrations, compare) {
  const reference = new Database(":memory:");
  try {
    for (const { name } of migrations) reference.exec(sqlFor(root, name));
    compare(reference);
  } finally { reference.close(); }
}

function checkLegacyVersion(db, root, migrations, version) {
  if (!legacyVersions.has(version)) throw new Error(`初始化路径缺少目标版本核验规则：${version}`);
  const versionIndex = migrations.findIndex(item => item.name === version);
  compareWithMigrations(root, migrations.slice(0, versionIndex + 1), reference => checkBaselineStructure(db, reference));
}

export function identifyMigration(db, root) {
  const migrations = localMigrations(root);
  const baselineIndex = migrations.findIndex(item => item.name === baseline);
  if (baselineIndex < 0) throw new Error("仓库缺少 v1.0 基线迁移");
  const prisma = hasTable(db, "_prisma_migrations");
  const legacyRecorded = hasTable(db, legacyHistory);
  if (prisma && legacyRecorded) throw new Error("迁移历史来源冲突");
  const method = prisma ? "prisma" : "baseline";
  const afterBaseline = migrations.slice(baselineIndex + 1);
  const rows = prisma
    ? db.prepare('SELECT migration_name name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name').all().filter(row => !row.rolled_back_at)
    : legacyRecorded ? db.prepare('SELECT name, checksum FROM "_replay_schema_migrations" ORDER BY name').all() : [];
  const candidates = prisma ? migrations : afterBaseline;
  if ((prisma && rows.length <= baselineIndex) || (legacyRecorded && !rows.length)
    || rows.some((row, i) => row.name !== candidates[i]?.name || (prisma && !row.finished_at) || !checksumMatches(root, row.name, row.checksum))) {
    throw new Error("迁移历史不完整、低于 v1.0 或校验和不符");
  }
  const version = rows.at(-1)?.name ?? baseline;
  const pending = candidates.slice(rows.length).map(item => item.name);
  if (prisma) {
    const actual = hash(JSON.stringify(schemaObjects(db)));
    compareWithMigrations(root, rows, reference => {
      if (actual !== hash(JSON.stringify(schemaObjects(reference)))) throw new Error("数据库结构与迁移历史不符");
    });
  } else {
    checkLegacyVersion(db, root, migrations, version);
    const unsupported = pending.find(name => !legacyVersions.has(name));
    if (unsupported) throw new Error(`初始化路径缺少目标版本核验规则：${unsupported}`);
  }
  if (version >= achievementsMigration && !db.prepare('SELECT 1 FROM "AchievementSyncState" WHERE id = 1').get()) {
    throw new Error("成就同步状态缺失");
  }
  return { method, pending, migrations };
}

export function applyBaselineMigrations(db, root) {
  const plan = identifyMigration(db, root);
  if (plan.method !== "baseline") throw new Error("该数据库应使用 Prisma 迁移");
  for (const name of plan.pending) {
    const sql = sqlFor(root, name);
    db.transaction(() => {
      db.exec(sql);
      checkLegacyVersion(db, root, plan.migrations, name);
      if (db.pragma("foreign_key_check").length) throw new Error(`迁移后外键异常：${name}`);
      db.exec('CREATE TABLE IF NOT EXISTS "_replay_schema_migrations" (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL)');
      db.prepare('INSERT INTO "_replay_schema_migrations" VALUES (?, ?)').run(name, hash(sql));
    }).immediate();
  }
}
