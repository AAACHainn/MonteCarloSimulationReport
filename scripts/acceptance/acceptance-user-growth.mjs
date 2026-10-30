import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

// Stages 3/4 use an independent backup of the stage-2 acceptance data. Never migrate on startup.
const root = fileURLToPath(new URL("../..", import.meta.url));
const database = join(root, "tmp/user-growth-stage34/acceptance.db");
if (!existsSync(database) || realpathSync(database) !== resolve(database)) throw new Error("Prepare the isolated acceptance database first; refusing fallback to .env");
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "0.0.0.0", "--port", "3102"], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...process.env, USER_GROWTH_ACCEPTANCE: "1", USER_GROWTH_ADVANCED_ACCEPTANCE: "1", MARKET_DATA_SYNC_ENABLED: "0", DATABASE_URL: "file:" + database.replaceAll("\\", "/"), SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", SQLITE_SYNCHRONOUS: "FULL" },
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
