import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

// Final acceptance remains separate from the daily database and earlier acceptance.
const root = fileURLToPath(new URL("../", import.meta.url));
const database = join(root, "tmp/user-growth-stage5/acceptance.db");
if (!existsSync(database) || realpathSync(database) !== resolve(database)) throw new Error("Prepare and verify the stage-5 copy first; refusing fallback to .env");
const mode = process.argv.includes("--production") ? "start" : "dev";
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), mode, "--hostname", "0.0.0.0", "--port", "3103"], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...process.env, USER_GROWTH_ACCEPTANCE: "1", USER_GROWTH_FINAL_ACCEPTANCE: "1", MARKET_DATA_SYNC_ENABLED: "0", DATABASE_URL: "file:" + database.replaceAll("\\", "/"), USER_AVATAR_DIR: join(root, "tmp/user-growth-stage5/avatars"), SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", SQLITE_SYNCHRONOUS: "FULL" },
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
