import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { identifyMigration, localMigrations } from "./sqlite-upgrade-plan.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const cacheDirectory = join(projectRoot, "tmp", "vitest-sqlite-templates");
const initScript = join(projectRoot, "scripts", "database", "init-sqlite.mjs");
const runFile = promisify(execFile);

function validateTemplate(file, readonly) {
  const db = new Database(file, { readonly, fileMustExist: true });
  try {
    if (!readonly) db.pragma("journal_mode = DELETE");
    const plan = identifyMigration(db, projectRoot);
    if (plan.method !== "prisma" || plan.pending.length ||
      db.pragma("journal_mode", { simple: true }) !== "delete" ||
      db.pragma("quick_check", { simple: true }) !== "ok" ||
      db.pragma("foreign_key_check").length > 0) {
      throw new Error(`无效的 SQLite 测试模板：${file}`);
    }
  } finally {
    db.close();
  }
}

async function prepareTemplate() {
  const key = createHash("sha256")
    .update(JSON.stringify(localMigrations(projectRoot)))
    .update(readFileSync(join(projectRoot, "prisma", "schema.prisma")))
    .update(readFileSync(initScript))
    .digest("hex");
  mkdirSync(cacheDirectory, { recursive: true });
  const template = join(cacheDirectory, `${key}.db`);
  if (!existsSync(template)) {
    // SQLite releases the build lock automatically if the Vitest process exits.
    const lock = new Database(join(cacheDirectory, `${key}.lock.db`), { timeout: 100 });
    try {
      while (!existsSync(template)) {
        try {
          lock.exec("BEGIN IMMEDIATE");
        } catch (error) {
          if (!(error instanceof Database.SqliteError) || error.code !== "SQLITE_BUSY") throw error;
          await delay(200);
          continue;
        }
        if (!existsSync(template)) {
          const staging = mkdtempSync(join(cacheDirectory, "build-"));
          const database = join(staging, "template.db");
          const start = performance.now();
          console.info("正在生成 SQLite 集成测试模板…");
          await runFile(process.execPath, [initScript], {
            cwd: projectRoot,
            env: { ...process.env, DATABASE_URL: `file:${database.replaceAll("\\", "/")}` },
            windowsHide: true,
          });
          validateTemplate(database, false);
          renameSync(database, template);
          rmdirSync(staging);
          console.info(`SQLite 集成测试模板已生成（${((performance.now() - start) / 1000).toFixed(1)} 秒）。`);
        }
        break;
      }
    } finally {
      lock.close();
    }
  }
  validateTemplate(template, true);
  return template;
}

export default async function setup({ provide }) {
  provide("sqliteFixtureTemplate", await prepareTemplate());
}
