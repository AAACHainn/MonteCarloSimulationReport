import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const rootRequire = createRequire(import.meta.url);
const Database = rootRequire("better-sqlite3");
if (rootRequire("better-sqlite3/package.json").version !== "12.8.0") throw new Error("Revalidate the SQLite driver before changing its locked version");
try { const probe = new Database(":memory:"); probe.close(); }
catch {
  const directory = dirname(rootRequire.resolve("better-sqlite3/package.json"));
  const prebuild = rootRequire.resolve("prebuild-install/bin.js", { paths: [directory] });
  execFileSync(process.execPath, [prebuild], { cwd: directory, stdio: "inherit", windowsHide: true,
    env: { ...process.env, npm_config_cache: resolve("tmp/sqlite-wal-native-cache") } });
}
const probe = new Database(":memory:");
try {
  const version = probe.prepare("SELECT sqlite_version() AS version").get().version;
  if (version !== "3.51.3") throw new Error("Unexpected SQLite engine: " + version);
  console.log("Prepared SQLite driver:", version);
} finally { probe.close(); }
