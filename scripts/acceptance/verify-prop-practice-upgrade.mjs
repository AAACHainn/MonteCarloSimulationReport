// Offline rehearsal; verify mode only reads an explicitly supplied existing target.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const source = resolve(process.argv[2] ?? "tmp/prop-practice-backup-20261023/stopped-consistent.db");
const target = resolve(process.argv[3] ?? "tmp/prop-practice-backup-20261023/rehearsal-init.db");
const mode = process.argv[4] ?? "init";
if (source === target || (mode !== "verify" && (existsSync(target) || !target.includes("prop-practice-backup-")))) throw new Error("Use a new isolated rehearsal path inside the prop-practice backup folder.");
const before = new Database(source, { readonly: true, fileMustExist: true });
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const tables = before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
function digest(db, name, columns) {
  const hash = createHash("sha256"); let count = 0;
  for (const row of db.prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(name)} ORDER BY rowid`).iterate()) {
    hash.update(JSON.stringify(row, (_key, v) => typeof v === "bigint" ? v.toString() : v)); count++;
  }
  return { count, sha256: hash.digest("hex") };
}
const baseline = tables.map(({ name }) => {
  const columns = before.pragma(`table_info(${quote(name)})`).map(c => c.name);
  return { name, columns, ...digest(before, name, columns) };
});
console.log("Baseline hashed", baseline.length, "tables");
if (mode !== "verify") await before.backup(target);
before.close();
if (mode === "init") {
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: "file:" + target, MARKET_DATA_SYNC_ENABLED: "0" }, stdio: "pipe" });
} else if (mode === "migration") {
  const db = new Database(target); db.pragma("foreign_keys=ON");
  db.transaction(() => db.exec(readFileSync("prisma/migrations/20261023120000_prop_practice/migration.sql", "utf8")))(); db.close();
} else if (mode !== "verify") throw new Error("Unknown rehearsal mode");
const after = new Database(target, { readonly: true });
const changes = baseline.filter(table => { const result = digest(after, table.name, table.columns); return result.count !== table.count || result.sha256 !== table.sha256; }).map(t => t.name);
const integrity = after.pragma("integrity_check"), foreignKeys = after.pragma("foreign_key_check");
const categories = after.prepare("SELECT accountCategory, count(*) count FROM ReplaySession GROUP BY accountCategory").all();
const result = { source, target, mode, changes, integrity, foreignKeys, categories, baseline };
writeFileSync((mode === "verify" ? source + ".verify" : target) + ".report.json", JSON.stringify(result, null, 2)); after.close();
console.log(JSON.stringify({ target, changes, integrity, foreignKeys, categories }));
if (changes.length || foreignKeys.length || integrity[0]?.integrity_check !== "ok") process.exitCode = 1;
