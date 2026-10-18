import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, "../..");
const target = join(root, "tmp/sqlite-wal-candidate");
mkdirSync(target, { recursive: true });
for (const [source, destination] of [["candidate-package.json", "package.json"], ["candidate-workspace.yaml", "pnpm-workspace.yaml"], ["candidate-lock.yaml", "pnpm-lock.yaml"]]) {
  const contents = readFileSync(join(directory, source));
  const output = join(target, destination);
  if (existsSync(output) && !readFileSync(output).equals(contents)) throw new Error("Existing candidate configuration differs: " + output);
  writeFileSync(output, contents);
}
if (process.argv.includes("--native")) {
  const candidateRequire = createRequire(join(target, "package.json"));
  const Database = candidateRequire("better-sqlite3");
  try { const probe = new Database(":memory:"); probe.close(); }
  catch {
    const driverDirectory = dirname(candidateRequire.resolve("better-sqlite3/package.json"));
    const prebuild = candidateRequire.resolve("prebuild-install/bin.js", { paths: [driverDirectory] });
    execFileSync(process.execPath, [prebuild], { cwd: driverDirectory, stdio: "inherit", windowsHide: true,
      env: { ...process.env, npm_config_cache: join(root, "tmp/sqlite-wal-native-cache") } });
  }
  const probe = new Database(":memory:");
  try {
    const version = probe.prepare("SELECT sqlite_version() AS version").get().version;
    if (version !== "3.51.3") throw new Error("Unexpected SQLite version: " + version);
    console.log("Candidate SQLite:", version);
  } finally { probe.close(); }
} else {
  console.log("Prepared isolated candidate in tmp/sqlite-wal-candidate. Install it with the documented frozen-lockfile command, then run --native.");
}
