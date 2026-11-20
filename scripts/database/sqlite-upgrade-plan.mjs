import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const baseline = "20261026170000_user_wallet_transfers";
const paneMigration = "20261120120000_market_drawing_pane";
const legacyVersions = {
  [baseline]: "d40c80124cb4e199d8dbb68ede5a5fbf7b2b5042baf8b8a9ea3ea67bbfe122f2",
  [paneMigration]: "2481d0024af0f038fb4bb01ad3190a9b2b9b7ecb5d921890f2814802a71bcaf0",
};
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
  const actual = hash(JSON.stringify(schemaObjects(db)));
  const version = rows.at(-1)?.name ?? baseline;
  if (prisma) {
    const reference = new Database(":memory:");
    try {
      for (const row of rows) reference.exec(sqlFor(root, row.name));
      if (actual !== hash(JSON.stringify(schemaObjects(reference)))) throw new Error("数据库结构与迁移历史不符");
    } finally { reference.close(); }
  } else if (actual !== legacyVersions[version]) {
    throw new Error("初始化路径的数据库结构与已核验的 v1.0 基线及后续版本不符");
  }
  return { method, pending: candidates.slice(rows.length).map(item => item.name), migrations };
}

export function applyBaselineMigrations(db, root) {
  const plan = identifyMigration(db, root);
  if (plan.method !== "baseline") throw new Error("该数据库应使用 Prisma 迁移");
  for (const name of plan.pending) {
    if (!legacyVersions[name]) throw new Error(`初始化路径缺少目标版本核验规则：${name}`);
    const sql = sqlFor(root, name);
    db.transaction(() => {
      db.exec(sql);
      if (db.pragma("foreign_key_check").length || hash(JSON.stringify(schemaObjects(db))) !== legacyVersions[name]) {
        throw new Error(`迁移后的结构或外键异常：${name}`);
      }
      db.exec('CREATE TABLE IF NOT EXISTS "_replay_schema_migrations" (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL)');
      db.prepare('INSERT INTO "_replay_schema_migrations" VALUES (?, ?)').run(name, hash(sql));
    }).immediate();
  }
}
