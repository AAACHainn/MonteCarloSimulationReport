import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, "../../..");
const args = new Set(process.argv.slice(2));
for (const arg of args) if (!["--benchmark", "--regression"].includes(arg)) throw new Error("Unknown argument: " + arg);
mkdirSync(join(root, "tmp/sqlite-wal-validation"), { recursive: true });
const preload = join(directory, "preload.cjs").replaceAll("\\", "/");
function run(mode, arguments_) {
  console.log("SQLite validation:", mode, arguments_.join(" "));
  const env = { ...process.env, MARKET_DATA_SYNC_ENABLED: "0", SQLITE_WAL_VALIDATION_MODE: mode, SQLITE_WAL_VALIDATION_TRACE: "1",
    SQLITE_WAL_USE_APPLICATION_DRIVER: "1", SQLITE_SYNCHRONOUS: "FULL", SQLITE_DRIVER: mode === "native-delete" ? "native" : "better-sqlite3", SQLITE_JOURNAL_MODE: mode === "wal" ? "wal" : "delete",
    NODE_OPTIONS: ((process.env.NODE_OPTIONS ?? "") + ' --require="' + preload + '"').trim() };
  const result = spawnSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", ...arguments_, "--maxWorkers=1", "--minWorkers=1", "--hookTimeout=120000", "--testTimeout=180000"],
    { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!args.has("--regression")) {
  for (const mode of ["native-delete", "delete", "wal"]) run(mode, ["--config", "scripts/benchmarks/sqlite-wal/benchmark.config.ts"]);
  const results = ["native-delete", "delete", "wal"].map(mode => JSON.parse(readFileSync(join(root, "tmp/sqlite-wal-validation/benchmark-" + mode + ".json"), "utf8")));
  console.table(results.flatMap(result => result.report.map(row => ({ mode: result.mode, scenario: row.scenario, medianMs: row.medianMs, p95Ms: row.p95Ms, commitMs: row.medianCommitMs }))));
}
if (!args.has("--benchmark")) run("wal", ["lib/market-replay/advance.integration.test.ts", "lib/replay-sessions/sessions.integration.test.ts", "lib/replay-sessions/training-gate.integration.test.ts"]);
