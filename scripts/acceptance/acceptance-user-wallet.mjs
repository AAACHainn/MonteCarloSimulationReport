import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
const root = fileURLToPath(new URL("../..", import.meta.url));
const database = join(root, "tmp/user-wallet/acceptance.db");
const env = { ...process.env, DATABASE_URL: "file:" + database.replaceAll("\\", "/"), USER_AVATAR_DIR: join(root, "tmp/user-wallet/avatars"), MARKET_DATA_SYNC_ENABLED: "0", SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", SQLITE_SYNCHRONOUS: "FULL", USER_GROWTH_ACCEPTANCE: "0", USER_GROWTH_PREVIEW: "0", USER_GROWTH_FINAL_ACCEPTANCE: "0", USER_GROWTH_ADVANCED_ACCEPTANCE: "0" };
if (process.argv.includes("--prepare")) {
  if (existsSync(database)) throw new Error("Acceptance database already exists; preserving its data. Start without --prepare.");
  mkdirSync(dirname(database), { recursive: true });
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { cwd: root, env, stdio: "inherit", windowsHide: true });
  execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/seed-user-wallet.ts"], { cwd: root, env, stdio: "inherit", windowsHide: true });
} else {
  if (!existsSync(database) || realpathSync(database) !== resolve(database)) throw new Error("Prepare the isolated wallet database first; refusing fallback to .env.");
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), process.argv.includes("--dev") ? "dev" : "start", "--hostname", "0.0.0.0", "--port", "3105"], { cwd: root, env, stdio: "inherit", windowsHide: true });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
