import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSqlitePath } from "../../lib/sqlite-client.mjs";
import { identifyMigration } from "./sqlite-upgrade-plan.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const envFile = join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const file = resolveSqlitePath(process.env.DATABASE_URL, root);
if (existsSync(file + ".upgrade.lock")) throw new Error("数据库有升级锁，请检查升级报告");
let ready = false;
if (existsSync(file)) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    ready = Boolean(db.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get());
    if (ready && identifyMigration(db, root).pending.length) throw new Error("现有数据库需要先离线执行 db:upgrade");
  } finally { db.close(); }
}
if (!ready) {
  mkdirSync(dirname(file), { recursive: true });
  // Create an empty file with the local SQLite driver so the CLI can open it
  // consistently for absolute Windows paths and mounted data volumes.
  if (!existsSync(file)) new Database(file).close();
  const child = spawnSync(process.execPath, [join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: root, env: { ...process.env, DATABASE_URL: "file:" + file.replaceAll("\\", "/") }, stdio: "inherit", windowsHide: true });
  if (child.error || child.status !== 0) throw new Error("新数据库初始化失败", { cause: child.error });
}
console.log("SQLite database ready.");
