import Database from "better-sqlite3";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { resolveSqlitePath, SQLITE_DRIVER_VERSION } from "../lib/sqlite-client.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const json = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? { bigint: String(item) } : item);
const hash = value => createHash("sha256").update(value).digest("hex");
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const open = (file, readonly = true) => new Database(file, { readonly, fileMustExist: true, timeout: 5000 });

function destinationPath(file) {
  if (existsSync(file)) return realpathSync(file);
  return join(destinationPath(dirname(file)), basename(file));
}

export function checkIntegrity(db) {
  const integrity = db.pragma("integrity_check"), foreignKeys = db.pragma("foreign_key_check");
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok" || foreignKeys.length) throw new Error("数据库完整性或外键检查失败");
  return { integrity: "ok", foreignKeyViolations: 0 };
}

// Stream every value; no sampling, ORM result limits or floating-point conversion of Int64.
export function fingerprint(db, selection) {
  const tables = selection ?? db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all().map(({ name }) => ({ name }));
  const result = [];
  for (const table of tables) {
    const info = db.pragma(`table_info(${quote(table.name)})`);
    const columns = table.columns ?? info.map(column => column.name);
    if (!info.length || columns.some(column => !info.some(item => item.name === column))) throw new Error(`原表或原字段缺失：${table.name}`);
    const keys = info.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    const order = keys.length ? keys : columns;
    const digest = createHash("sha256"); let count = 0;
    for (const row of db.prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(table.name)} ORDER BY ${order.map(quote).join(",")}`).safeIntegers().iterate()) {
      digest.update(json(row) + "\n"); count++;
    }
    result.push({ name: table.name, columns, count, sha256: digest.digest("hex") });
  }
  return result;
}

function assertSame(actual, expected, label) {
  if (json(actual) !== json(expected)) throw new Error(`${label}不一致，停止升级；请查看报告并保留现场`);
}

export function identifyMigration(db, root = projectRoot) {
  const migrations = identifyLocalMigrations(root);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  if (!tables.includes("_prisma_migrations")) {
    if (!tables.includes("MarketDataset") && !tables.includes("TradeDataset")) throw new Error("不是可识别的现有业务库；新安装请使用原初始化流程");
    return { method: "init", pending: null, migrations };
  }
  const rows = db.prepare('SELECT * FROM "_prisma_migrations" ORDER BY migration_name').all();
  if (!rows.length) throw new Error("迁移历史表为空，无法安全识别原安装方式；不自动转用初始化脚本");
  const applied = [];
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at) throw new Error(`存在未完成/失败迁移：${row.migration_name}`);
    const local = migrations.find(item => item.name === row.migration_name);
    const sql = local ? readFileSync(join(root, "prisma/migrations", local.name, "migration.sql"), "utf8") : "";
    const lineEndings = [hash(sql), hash(sql.replaceAll("\r\n", "\n")), hash(sql.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"))];
    if (!local || !lineEndings.includes(row.checksum) || applied.includes(row.migration_name)) throw new Error(`迁移历史分叉、重复或校验和不符：${row.migration_name}`);
    applied.push(row.migration_name);
  }
  if (!applied.length || applied.some((name, index) => migrations[index]?.name !== name)) throw new Error("迁移历史不是本仓库的完整前缀；需人工核查，不自动修复基线");
  return { method: "prisma", pending: migrations.slice(applied.length).map(item => item.name), migrations };
}

function checkTarget(db) {
  const models = Prisma.dmmf.datamodel.models;
  const relations = new Set();
  for (const model of models) {
    const columns = db.pragma(`table_info(${quote(model.dbName ?? model.name)})`).map(item => item.name);
    if (!columns.length || model.fields.some(field => field.kind !== "object" && !columns.includes(field.dbName ?? field.name))) throw new Error(`升级后结构不完整：${model.name}，请先确认 Prisma Client 已按当前 schema 生成`);
    // Prisma's implicit many-to-many tables are not DMMF models. Detect both
    // list ends of the relation, including explicitly named implicit relations.
    for (const field of model.fields) {
      if (field.kind !== "object" || !field.isList || !field.relationName || field.relationFromFields?.length) continue;
      const opposite = models.find(item => item.name === field.type);
      if (opposite?.fields.some(item => item !== field && item.kind === "object" && item.isList && item.type === model.name && item.relationName === field.relationName && !item.relationFromFields?.length)) relations.add("_" + field.relationName);
    }
  }
  for (const table of relations) {
    const columns = db.pragma(`table_info(${quote(table)})`).map(item => item.name);
    if (!["A", "B"].every(name => columns.includes(name))) throw new Error(`升级后隐式关联表缺失或字段不完整：${table}`);
  }
  return checkIntegrity(db);
}

function executionManifest(root, method) {
  const files = ["scripts/upgrade-sqlite.mjs", "lib/sqlite-client.mjs", "package.json", "pnpm-lock.yaml",
    method === "init" ? "scripts/init-sqlite.mjs" : "node_modules/prisma/build/index.js"];
  return files.map(name => ({ name, sha256: hash(readFileSync(join(root, name))) }));
}

function assertExecutionUnchanged(root, manifest) {
  for (const item of manifest) {
    const file = join(root, item.name);
    if (!existsSync(file) || hash(readFileSync(file)) !== item.sha256) throw new Error(`升级执行代码已变化：${item.name}；停止后续阶段，请固定代码版本重新演练`);
  }
}

function schemaFingerprint(db) {
  return hash(json(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND tbl_name != '_prisma_migrations' ORDER BY type,name").all()));
}

function prepareJournal(file, mode, isolatedCopy) {
  const db = open(file, false);
  try {
    db.pragma("synchronous=FULL");
    const current = db.pragma("journal_mode", { simple: true });
    if (current !== mode && !isolatedCopy) throw new Error("正式库日志模式已变化，停止升级而不自动切换");
    // Only the isolated backup copy may need its source's original WAL mode.
    // Never switch a live WAL database to DELETE, or force a WAL checkpoint.
    if (current !== mode && db.pragma(`journal_mode=${mode}`, { simple: true }) !== mode) throw new Error(`无法设置日志模式至 ${mode}`);
    db.exec("BEGIN EXCLUSIVE; COMMIT;");
  } finally { db.close(); }
}

function runCommand(args, env, logFile, root) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(logFile, (result.stdout ?? "") + (result.stderr ?? "") + (result.error?.stack ?? ""), { mode: 0o600 });
  if (result.error || result.status !== 0) throw new Error(`升级子进程失败，退出码 ${result.status}；日志：${logFile}`);
}

/** No SQL migrations are reimplemented here. Both stages invoke the existing entry point. */
export async function upgradeDatabase(options, execute = runCommand) {
  const root = options.root ?? projectRoot, filesRoot = options.filesRoot ?? root, env = options.env ?? process.env;
  if (!options.expectedDatabase || !isAbsolute(options.expectedDatabase)) throw new Error("需要明确的数据库绝对路径");
  const file = realpathSync(resolveSqlitePath(env.DATABASE_URL, root));
  const expected = realpathSync(resolve(options.expectedDatabase));
  if (file !== expected || !statSync(file).isFile() || !options.stopped) throw new Error("数据库路径未确认或未确认停写");
  const identity = statSync(file);
  const lockFile = file + ".upgrade.lock";
  // Exclusive creation prevents overlapping upgrade commands. Failures retain the lock.
  const lock = openSync(lockFile, "wx", 0o600); closeSync(lock);
  let directory, report;
  try {
    directory = join(resolve(options.backupDirectory ?? join(dirname(root), basename(root) + "-db-upgrades")), new Date().toISOString().replaceAll(/[:.]/g, "-") + "-" + randomUUID());
    // Avoid recursively copying the backup into itself via storage/import directories.
    for (const name of ["storage", ".market-imports"]) {
      const nested = relative(destinationPath(resolve(filesRoot, name)), destinationPath(directory));
      if (nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))) throw new Error("备份目录不能位于 storage 或导入目录内");
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    save(lockFile, { pid: process.pid, database: file, directory });
    report = { status: "RUNNING", phase: "backup", database: file, directory, startedAt: new Date().toISOString(), node: process.version };
    save(join(directory, "report.json"), report);
    console.log("数据库：", file, "\n备份和演练：", directory);
    const original = open(file);
    let baseline, plan, mode, sourceSchema;
    try {
      if (original.prepare("SELECT sqlite_version() version").get().version !== SQLITE_DRIVER_VERSION) throw new Error("SQLite 维护驱动版本与项目锁定版本不符");
      mode = original.pragma("journal_mode", { simple: true });
      if (!["wal", "delete"].includes(mode)) throw new Error(`不支持自动处理的日志模式：${mode}`);
      checkIntegrity(original);
      // SQLite backup reads committed WAL frames; never copy only the live main file.
      await original.backup(join(directory, "before.db"));
    } finally { original.close(); }
    const backup = open(join(directory, "before.db"));
    try { checkIntegrity(backup); baseline = fingerprint(backup); sourceSchema = schemaFingerprint(backup); plan = identifyMigration(backup, root); } finally { backup.close(); }
    save(join(directory, "baseline.json"), baseline);
    report.method = plan.method; report.originalJournalMode = mode; report.pending = plan.pending; report.sourceSchema = sourceSchema;
    report.migrationChecksums = plan.migrations;
    report.schemaChecksum = hash(readFileSync(join(root, "prisma/schema.prisma")));
    const execution = executionManifest(root, plan.method);
    report.executionCode = execution;
    for (const name of [".env", "storage", ".market-imports"]) {
      const source = join(filesRoot, name);
      if (!existsSync(source)) continue;
      if (name === ".env") writeFileSync(join(directory, "environment.backup"), readFileSync(source), { mode: 0o600, flag: "wx" });
      else cpSync(source, join(directory, name), { recursive: true, errorOnExist: true, force: false });
    }
    // init uses the current validated driver. Prisma CLI has its own engine and
    // does not inherit this adapter; both paths run offline in the original mode.
    const childEnv = { ...env, DATABASE_URL: "", SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: mode, SQLITE_SYNCHRONOUS: "FULL", MARKET_DATA_SYNC_ENABLED: "0" };
    report.migrationJournalMode = mode;
    const migrate = (target, stage) => {
      assertExecutionUnchanged(root, execution);
      prepareJournal(target, mode, target !== file);
      const args = plan.method === "init" ? [join(root, "scripts/init-sqlite.mjs")] : [join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", join(root, "prisma/schema.prisma")];
      assertExecutionUnchanged(root, execution);
      execute(args, { ...childEnv, DATABASE_URL: "file:" + target.replaceAll("\\", "/") }, join(directory, stage + ".log"), root);
      assertExecutionUnchanged(root, execution);
      const db = open(target);
      try {
        checkTarget(db);
        assertSame(db.pragma("journal_mode", { simple: true }), mode, "升级过程日志模式");
        const afterPlan = identifyMigration(db, root);
        if (afterPlan.method !== plan.method || (afterPlan.pending?.length ?? 0)) throw new Error("迁移路径发生变化或仍有待应用项");
        return { data: fingerprint(db), schema: schemaFingerprint(db) };
      } finally { db.close(); }
    };
    const rehearsal = join(directory, "rehearsal.db");
    copyFileSync(join(directory, "before.db"), rehearsal, constants.COPYFILE_EXCL);
    report.phase = "rehearsal"; save(join(directory, "report.json"), report);
    const rehearsed = migrate(rehearsal, "rehearsal");
    save(join(directory, "rehearsal.json"), rehearsed);
    const rehearsedDb = open(rehearsal);
    try {
      // Conservative gate: do not silently approve legacy destructive conversions.
      // Additive columns/tables are fine; any original row/column change needs review.
      assertSame(fingerprint(rehearsedDb, baseline), baseline, "演练前后原有数据");
    } finally { rehearsedDb.close(); }
    // Re-run the same upgrade on the copy before touching the source.
    assertSame(migrate(rehearsal, "rehearsal-repeat"), rehearsed, "重复执行演练");
    const live = open(file);
    try {
      assertSame(fingerprint(live), baseline, "备份后正式库数据");
      assertSame(schemaFingerprint(live), sourceSchema, "备份后正式库结构");
      assertSame(identifyMigration(live, root), plan, "正式库迁移历史");
    } finally { live.close(); }
    const currentIdentity = statSync(file);
    if (currentIdentity.dev !== identity.dev || currentIdentity.ino !== identity.ino || realpathSync(resolveSqlitePath(env.DATABASE_URL, root)) !== file) throw new Error("数据库文件已被替换");
    assertSame(hash(readFileSync(join(root, "prisma/schema.prisma"))), report.schemaChecksum, "目标 schema");
    assertSame(identifyLocalMigrations(root), plan.migrations, "迁移文件");
    assertExecutionUnchanged(root, execution);
    report.phase = "apply"; save(join(directory, "report.json"), report);
    const actual = migrate(file, "apply");
    save(join(directory, "actual.json"), actual);
    assertSame(actual, rehearsed, "正式升级与演练结果");
    const upgraded = open(file);
    try { assertSame(fingerprint(upgraded, baseline), baseline, "正式库原有数据"); } finally { upgraded.close(); }
    const final = open(file);
    try { checkTarget(final); assertSame(final.pragma("journal_mode", { simple: true }), mode, "保留日志模式"); } finally { final.close(); }
    report.status = "SUCCESS"; report.phase = "complete"; report.finishedAt = new Date().toISOString();
    save(join(directory, "report.json"), report);
    unlinkSync(lockFile);
    console.log("升级及数据核对成功；原日志模式保持：", mode, "\n报告：", join(directory, "report.json"));
    return report;
  } catch (error) {
    if (report) { report.status = "FAILED"; report.error = error.message; save(join(directory, "report.json"), report); }
    console.error("升级已停止，保留数据库、WAL/SHM、备份、副本、日志及维护锁。未自动恢复或重置数据库。", directory ?? lockFile);
    throw error;
  }
}

function identifyLocalMigrations(root) {
  return readdirSync(join(root, "prisma/migrations")).filter(name => existsSync(join(root, "prisma/migrations", name, "migration.sql"))).sort().map(name => ({ name, checksum: hash(readFileSync(join(root, "prisma/migrations", name, "migration.sql"))) }));
}

async function main() {
  if (existsSync(join(projectRoot, ".env"))) process.loadEnvFile(join(projectRoot, ".env"));
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--stopped") options.stopped = true;
    else if (["--expect-database", "--backup-dir"].includes(arg) && args[index + 1] && !args[index + 1].startsWith("--")) options[arg === "--expect-database" ? "expectedDatabase" : "backupDirectory"] = args[++index];
    else if (arg === "--help") { console.log("corepack pnpm run db:upgrade [--expect-database <existing absolute path>] [--stopped] [--backup-dir <directory>]\n无参数时交互核对路径与停写；非交互必须明确提供路径与 --stopped。失败保留维护锁，禁止自动重置。"); return; }
    else throw new Error("未知或缺少值的参数：" + arg);
  }
  const file = realpathSync(resolveSqlitePath(process.env.DATABASE_URL, projectRoot));
  if ((!options.expectedDatabase || !options.stopped) && process.stdin.isTTY) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log("将升级现有数据库：", file);
      options.expectedDatabase ??= await terminal.question("请输入上述数据库完整绝对路径以核对：");
      options.stopped ||= (await terminal.question("请先停止本项目服务及全部 worker；已停写请输入 STOPPED：")) === "STOPPED";
    } finally { terminal.close(); }
  }
  if (!options.expectedDatabase || !options.stopped) throw new Error("非交互运行需要 --expect-database <绝对路径> 和 --stopped；命令不会替你停止服务");
  await upgradeDatabase(options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
