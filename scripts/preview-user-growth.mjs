import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A UI-only instance: no worker imports, no business database, no shared Next output.
const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "0.0.0.0", "--port", "3100"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    USER_GROWTH_PREVIEW: "1",
    MARKET_DATA_SYNC_ENABLED: "0",
    // The adapter refuses a missing file. No directory or database is created.
    DATABASE_URL: "file:" + join(tmpdir(), "user-growth-preview-no-database", "disabled.db").replaceAll("\\", "/"),
    SQLITE_DRIVER: "better-sqlite3",
    SQLITE_JOURNAL_MODE: "wal",
    SQLITE_SYNCHRONOUS: "FULL",
  },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
