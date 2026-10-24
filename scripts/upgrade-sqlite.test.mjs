import { beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanupRehearsal, fingerprint, identifyMigration, upgradeDatabase } from "./upgrade-sqlite.mjs";

const directory = mkdtempSync(join(tmpdir(), "db-upgrade-tests-"));
const base = join(directory, "base.db");
const root = process.cwd();
const childEnv = file => ({ ...process.env, DATABASE_URL: "file:" + file.replaceAll("\\", "/"), SQLITE_DRIVER: "native", SQLITE_JOURNAL_MODE: "delete", SQLITE_SYNCHRONOUS: "FULL", MARKET_DATA_SYNC_ENABLED: "0" });
const options = file => ({ expectedDatabase: file, stopped: true, filesRoot: directory, backupDirectory: join(directory, "backups-" + basename(file)), env: childEnv(file) });
const readReport = file => JSON.parse(readFileSync(join(readdirSync(options(file).backupDirectory).map(name => join(options(file).backupDirectory, name))[0], "report.json"), "utf8"));
function command(args, env, logFile) {
  const output = execFileSync(process.execPath, args, { cwd: root, env, windowsHide: true, encoding: "utf8", stdio: "pipe" });
  writeFileSync(logFile, output);
}
function fixture() {
  const file = join(directory, randomUUID() + ".db"); copyFileSync(base, file); return file;
}
function inspect(file, work) { const db = new Database(file, { fileMustExist: true }); try { return work(db); } finally { db.close(); } }
function preProp(file) {
  inspect(file, db => {
    db.pragma("foreign_keys=OFF");
    for (const name of ["PropPracticeRound", "PropPracticeEvent", "PropPracticePayout", "PropPracticeAccount", "PropPracticeTemplateVersion", "PropPracticeTemplate"]) db.exec(`DROP TABLE "${name}"`);
    db.exec('ALTER TABLE "ReplaySession" DROP COLUMN "accountCategory"');
  });
}
beforeAll(() => {
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { cwd: root, env: childEnv(base), stdio: "pipe", windowsHide: true });
  inspect(base, db => {
    db.exec(`INSERT INTO MarketDataset(id,name,symbol,timeframe,timezone,barCount,startTime,endTime,updatedAt) VALUES ('data','本机行情','ES','1m','UTC',1,1000,1000,1000);
      INSERT INTO MarketBar(datasetId,sequence,timestamp,open,high,low,close,volume) VALUES ('data',0,1000,100,110,90,105,10);
      INSERT INTO ReplaySession(id,datasetId,name,mode,updatedAt) VALUES ('session','data','保留原会话','TRAINING',1000);`);
  });
}, 30000);

describe("repeatable offline SQLite upgrade", () => {
  it("fills the missing prop fields/tables using the existing init script and safely repeats", async () => {
    const file = fixture(); preProp(file);
    const before = inspect(file, fingerprint);
    const first = await upgradeDatabase(options(file));
    expect(first).toMatchObject({ method: "init", originalJournalMode: "delete", status: "SUCCESS" });
    expect(inspect(file, db => fingerprint(db, before))).toEqual(before);
    expect(inspect(file, db => db.prepare('SELECT accountCategory FROM ReplaySession').get().accountCategory)).toBe("STANDARD");
    expect(existsSync(join(first.directory, "before.db"))).toBe(true);
    expect(first.cleanup.status).toBe("COMPLETE");
    expect(existsSync(join(first.directory, "rehearsal.db"))).toBe(false);
    expect(existsSync(join(first.directory, "rehearsal.db-wal"))).toBe(false);
    expect(existsSync(join(first.directory, "rehearsal.db-shm"))).toBe(false);
    expect(existsSync(join(first.directory, "rehearsal-repeat.log"))).toBe(true);
    expect(existsSync(file + ".upgrade.lock")).toBe(false);
    const after = inspect(file, fingerprint);
    const second = await upgradeDatabase(options(file));
    expect(second.status).toBe("SUCCESS"); expect(second.directory).not.toBe(first.directory);
    expect(inspect(file, fingerprint)).toEqual(after);
  }, 30000);

  it.each(["FULL", "NORMAL"])("backs up committed WAL-only records and keeps WAL through init, repeat and apply with original %s config", async synchronous => {
    const file = fixture(); preProp(file);
    const writer = new Database(file);
    writer.pragma("journal_mode=WAL"); writer.pragma("wal_autocheckpoint=0");
    writer.exec("UPDATE MarketBar SET close=107 WHERE datasetId='data'");
    expect(existsSync(file + "-wal")).toBe(true);
    try {
      const phases = [];
      const input = options(file);
      input.env = { ...input.env, SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", SQLITE_SYNCHRONOUS: synchronous };
      const result = await upgradeDatabase(input, (args, env, log) => {
        // Release the WAL-producing connection after the consistent backup,
        // before executing the offline migration.
        if (writer.open) writer.close();
        const target = env.DATABASE_URL.slice(5);
        expect(env.SQLITE_DRIVER).toBe("better-sqlite3"); expect(env.SQLITE_JOURNAL_MODE).toBe("wal");
        expect(inspect(target, db => db.pragma("journal_mode", { simple: true }))).toBe("wal");
        command(args, env, log);
        expect(inspect(target, db => db.pragma("journal_mode", { simple: true }))).toBe("wal");
        phases.push(basename(log));
      });
      expect(result).toMatchObject({ originalJournalMode: "wal", migrationJournalMode: "wal", status: "SUCCESS" });
      expect(phases).toEqual(["rehearsal.log", "rehearsal-repeat.log", "apply.log"]);
      expect(input.env.SQLITE_SYNCHRONOUS).toBe(synchronous);
      expect(inspect(join(result.directory, "before.db"), db => db.prepare("SELECT close FROM MarketBar").get().close)).toBe(107);
      expect(inspect(file, db => db.pragma("journal_mode", { simple: true }))).toBe("wal");
      expect(inspect(file, db => db.prepare("SELECT close FROM MarketBar").get().close)).toBe(107);
    } finally { if (writer.open) writer.close(); }
  }, 30000);

  it.each(["delete", "wal"])("uses migrate deploy with complete Prisma history and preserves %s throughout repeated upgrades", async mode => {
    const file = join(directory, `prisma-history-${mode}.db`);
    new Database(file).close();
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: root, env: childEnv(file), stdio: "pipe", windowsHide: true });
    preProp(file);
    inspect(file, db => db.exec("DELETE FROM _prisma_migrations WHERE migration_name IN ('20261023120000_prop_practice','20261024090000_prop_practice_rounds')"));
    inspect(file, db => {
      db.pragma(`journal_mode=${mode}`);
      db.exec(`INSERT INTO MarketDataset(id,name,symbol,timeframe,timezone,barCount,startTime,endTime,updatedAt) VALUES ('prisma-data','行情','ES','1m','UTC',1,1000,1000,1000);
        INSERT INTO MarketBar(datasetId,sequence,timestamp,open,high,low,close,volume) VALUES ('prisma-data',0,1000,100,110,90,105,10);`);
    });
    const plan = inspect(file, db => identifyMigration(db)); expect(plan.pending).toHaveLength(2);
    const before = inspect(file, fingerprint);
    const observed = [];
    const execute = (args, env, log) => {
      const target = env.DATABASE_URL.slice(5);
      expect(args).toContain("deploy");
      expect(inspect(target, db => db.pragma("journal_mode", { simple: true }))).toBe(mode);
      command(args, env, log);
      expect(inspect(target, db => db.pragma("journal_mode", { simple: true }))).toBe(mode);
      observed.push(basename(log));
    };
    const result = await upgradeDatabase(options(file), execute);
    expect(result).toMatchObject({ method: "prisma", originalJournalMode: mode, migrationJournalMode: mode });
    expect(inspect(file, db => identifyMigration(db).pending)).toEqual([]);
    expect((await upgradeDatabase(options(file), execute)).status).toBe("SUCCESS");
    expect(inspect(file, db => fingerprint(db, before))).toEqual(before);
    expect(observed).toEqual(["rehearsal.log", "rehearsal-repeat.log", "apply.log", "rehearsal.log", "rehearsal-repeat.log", "apply.log"]);
  }, 60000);

  it("refuses wrong paths, missing files, relative confirmation paths and missing stop acknowledgement without opening a new DB", async () => {
    const file = fixture(), missing = join(directory, "does-not-exist.db");
    await expect(upgradeDatabase({ ...options(file), expectedDatabase: base })).rejects.toThrow("路径");
    await expect(upgradeDatabase({ ...options(file), expectedDatabase: "relative.db" })).rejects.toThrow("绝对路径");
    await expect(upgradeDatabase({ ...options(file), stopped: false })).rejects.toThrow("停写");
    await expect(upgradeDatabase(options(missing))).rejects.toThrow(); expect(existsSync(missing)).toBe(false);
    expect(existsSync(file + ".upgrade.lock")).toBe(false);
  });

  it.each(["empty", "failed", "checksum"])("refuses %s Prisma history without falling back to init", async type => {
    const file = fixture();
    inspect(file, db => {
      db.exec('CREATE TABLE _prisma_migrations (migration_name TEXT,checksum TEXT,finished_at TEXT,rolled_back_at TEXT)');
      if (type !== "empty") db.prepare('INSERT INTO _prisma_migrations VALUES (?,?,?,NULL)').run("20260528083000_init", "wrong", type === "failed" ? null : "done");
    });
    const before = inspect(file, fingerprint);
    await expect(upgradeDatabase(options(file))).rejects.toThrow(/历史|迁移/);
    expect(inspect(file, fingerprint)).toEqual(before);
    expect(existsSync(file + ".upgrade.lock")).toBe(true);
    const report = readReport(file); expect(report.status).toBe("FAILED");
    expect(existsSync(join(report.directory, "before.db"))).toBe(true);
    expect(existsSync(join(report.directory, "apply.log"))).toBe(false);
  });

  it("stops before the official upgrade if rehearsal changes existing business data", async () => {
    const file = fixture(), before = inspect(file, fingerprint);
    await expect(upgradeDatabase(options(file), (args, env, log) => {
      command(args, env, log);
      inspect(env.DATABASE_URL.slice(5), db => db.exec("UPDATE MarketBar SET close=999"));
    })).rejects.toThrow("原有数据");
    expect(inspect(file, fingerprint)).toEqual(before);
    const report = readReport(file); expect(report.phase).toBe("rehearsal"); expect(existsSync(join(report.directory, "apply.log"))).toBe(false);
  }, 30000);

  it("detects external writes between backup and apply", async () => {
    const file = fixture();
    await expect(upgradeDatabase(options(file), (args, env, log) => {
      command(args, env, log);
      if (basename(log) === "rehearsal.log") inspect(file, db => db.exec("UPDATE MarketBar SET close=108"));
    })).rejects.toThrow("备份后正式库数据");
    expect(inspect(file, db => db.prepare("SELECT close FROM MarketBar").get().close)).toBe(108);
    expect(existsSync(join(readReport(file).directory, "apply.log"))).toBe(false);
  }, 30000);

  it("retains a partially failed official database and lock instead of restoring over it or retrying automatically", async () => {
    const file = fixture();
    await expect(upgradeDatabase(options(file), (args, env, log) => {
      if (basename(log) === "apply.log") {
        inspect(file, db => db.exec("CREATE TABLE FailureEvidence (id TEXT)"));
        writeFileSync(log, "simulated child interruption"); throw new Error("simulated apply failure");
      }
      command(args, env, log);
    })).rejects.toThrow("simulated apply failure");
    expect(inspect(file, db => db.prepare("SELECT name FROM sqlite_master WHERE name='FailureEvidence'").get())).toBeTruthy();
    const report = readReport(file); expect(report).toMatchObject({ phase: "apply", status: "FAILED" });
    expect(existsSync(join(report.directory, "before.db"))).toBe(true);
    await expect(upgradeDatabase(options(file))).rejects.toThrow(/EEXIST/);
  }, 30000);

  it("rejects a second concurrent upgrade and never steals the first process lock", async () => {
    const file = fixture(), lock = file + ".upgrade.lock";
    writeFileSync(lock, "another upgrade is active");
    await expect(upgradeDatabase(options(file))).rejects.toThrow(/EEXIST/);
    expect(readFileSync(lock, "utf8")).toBe("another upgrade is active");
  });

  it("retains WAL and backup if another write transaction prevents offline apply", async () => {
    const file = fixture(), writer = new Database(file);
    writer.pragma("journal_mode=WAL"); writer.exec("UPDATE MarketBar SET close=109");
    writer.exec("BEGIN IMMEDIATE");
    try {
      await expect(upgradeDatabase(options(file))).rejects.toThrow(/locked|WAL/);
      const report = readReport(file); expect(report.status).toBe("FAILED"); expect(report.phase).toBe("apply");
      expect(inspect(file, db => db.prepare("SELECT close FROM MarketBar").get().close)).toBe(109);
      expect(existsSync(join(report.directory, "before.db"))).toBe(true);
      expect(existsSync(file + ".upgrade.lock")).toBe(true);
      expect(writer.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally { writer.exec("ROLLBACK"); writer.close(); }
  }, 30000);

  it("backs up synthetic environment and attachments without changing source files", async () => {
    const file = fixture(), filesRoot = mkdtempSync(join(directory, "assets-"));
    mkdirSync(join(filesRoot, "storage")); mkdirSync(join(filesRoot, ".market-imports"));
    writeFileSync(join(filesRoot, ".env"), "SYNTHETIC_TEST_KEY=do-not-change\n");
    writeFileSync(join(filesRoot, "storage", "image.bin"), Buffer.from([0, 1, 2]));
    writeFileSync(join(filesRoot, ".market-imports", "pending.csv"), "synthetic fixture");
    const result = await upgradeDatabase({ ...options(file), filesRoot });
    expect(readFileSync(join(result.directory, "environment.backup"), "utf8")).toBe(readFileSync(join(filesRoot, ".env"), "utf8"));
    expect(readFileSync(join(result.directory, "storage", "image.bin"))).toEqual(Buffer.from([0, 1, 2]));
    expect(readFileSync(join(result.directory, ".market-imports", "pending.csv"), "utf8")).toBe("synthetic fixture");
  }, 30000);

  it("exposes help and rejects unattended use without an explicit database confirmation", () => {
    const output = execFileSync(process.execPath, ["scripts/upgrade-sqlite.mjs", "--help"], { cwd: root, env: childEnv(base), encoding: "utf8", stdio: "pipe", windowsHide: true });
    expect(output).toContain("--expect-database");
    expect(() => execFileSync(process.execPath, ["scripts/upgrade-sqlite.mjs"], { cwd: root, env: childEnv(base), stdio: "pipe", windowsHide: true })).toThrow();
    expect(existsSync(base + ".upgrade.lock")).toBe(false);
  });

  it("rejects a missing implicit relation table even with complete Prisma migration history", async () => {
    const file = join(directory, "missing-implicit.db");
    new Database(file).close();
    command(["node_modules/prisma/build/index.js", "migrate", "deploy"], childEnv(file), join(directory, "missing-implicit-setup.log"));
    inspect(file, db => db.exec('DROP TABLE "_TradeToTradeTag"'));
    const before = inspect(file, fingerprint);
    await expect(upgradeDatabase(options(file))).rejects.toThrow("隐式关联表");
    expect(inspect(file, fingerprint)).toEqual(before);
    const report = readReport(file);
    expect(existsSync(join(report.directory, "apply.log"))).toBe(false);
    expect(existsSync(join(report.directory, "rehearsal.db"))).toBe(true);
  }, 30000);

  it.each(["scripts/init-sqlite.mjs", "lib/sqlite-client.mjs"])("rejects changes to %s after rehearsal before formal writes", async changed => {
    const code = mkdtempSync(join(directory, "code-"));
    mkdirSync(join(code, "scripts")); mkdirSync(join(code, "lib")); mkdirSync(join(code, "prisma"));
    for (const name of ["scripts/upgrade-sqlite.mjs", "scripts/upgrade-sqlite-worker.mjs", "scripts/upgrade-sqlite-progress.mjs", "scripts/init-sqlite.mjs", "lib/sqlite-client.mjs", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "prisma/schema.prisma"]) copyFileSync(join(root, name), join(code, name));
    cpSync(join(root, "prisma/migrations"), join(code, "prisma/migrations"), { recursive: true });
    symlinkSync(join(root, "node_modules"), join(code, "node_modules"), "junction");
    const file = fixture(), before = inspect(file, fingerprint);
    await expect(upgradeDatabase({ ...options(file), root: code }, (args, env, log) => {
      command(args, env, log);
      if (basename(log) === "rehearsal-repeat.log") writeFileSync(join(code, changed), readFileSync(join(code, changed), "utf8") + "\n// changed after rehearsal\n");
    })).rejects.toThrow("升级实现代码");
    expect(inspect(file, fingerprint)).toEqual(before);
    expect(existsSync(join(readReport(file).directory, "apply.log"))).toBe(false);
  }, 30000);

  it("keeps database success separate from cleanup failure and does not keep the upgrade lock", async () => {
    const file = fixture();
    const result = await upgradeDatabase({ ...options(file), removeRehearsalFile: () => { throw new Error("synthetic sharing violation"); } });
    expect(result).toMatchObject({ status: "SUCCESS", databaseStatus: "SUCCESS", cleanup: { status: "FAILED", remaining: ["rehearsal.db"] } });
    expect(existsSync(join(result.directory, "before.db"))).toBe(true);
    expect(existsSync(join(result.directory, "rehearsal.db"))).toBe(true);
    expect(existsSync(file + ".upgrade.lock")).toBe(false);
  }, 30000);

  it("stops before apply on cancellation and retains the rehearsal and lock", async () => {
    const file = fixture(), flag = new Int32Array(new SharedArrayBuffer(4));
    await expect(upgradeDatabase({ ...options(file), cancelFlag: flag, onProgress: event => { if (event.stepId === "source-recheck") Atomics.store(flag, 0, 1); } })).rejects.toThrow("取消");
    const report = readReport(file);
    expect(report.formalWriteStarted).not.toBe(true);
    expect(existsSync(join(report.directory, "rehearsal.db"))).toBe(true);
    expect(existsSync(join(report.directory, "apply.log"))).toBe(false);
    expect(existsSync(file + ".upgrade.lock")).toBe(true);
  }, 30000);

  it("awaits a running apply child before observing cancellation and never cleans a cancelled upgrade", async () => {
    const file = fixture(), flag = new Int32Array(new SharedArrayBuffer(4));
    let applyFinished = false;
    await expect(upgradeDatabase({ ...options(file), cancelFlag: flag }, async (args, env, log) => {
      if (basename(log) === "apply.log") {
        Atomics.store(flag, 0, 1);
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(existsSync(file + ".upgrade.lock")).toBe(true);
        expect(existsSync(join(readReport(file).directory, "rehearsal.db"))).toBe(true);
        command(args, env, log); applyFinished = true;
      } else command(args, env, log);
    })).rejects.toThrow("取消");
    expect(applyFinished).toBe(true);
    expect(readReport(file)).toMatchObject({ formalWriteStarted: true, status: "FAILED" });
    expect(existsSync(join(readReport(file).directory, "rehearsal.db"))).toBe(true);
  }, 30000);

  it("emits truthful row references and isolates display failures from upgrade assertions", async () => {
    const file = fixture(), events = [];
    const result = await upgradeDatabase({ ...options(file), onProgress: event => { events.push(event); if (event.stepId === "files-backup") throw new Error("synthetic display failure"); } });
    expect(result.status).toBe("SUCCESS");
    expect(events.find(event => event.stepId === "baseline" && event.tableName === "MarketBar").referenceRows).toBe(null);
    expect(events.find(event => event.stepId === "final-original" && event.tableName === "MarketBar").referenceRows).toBe(1);
    expect(events.at(-1).state).toBe("SUCCESS");
    expect(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("保留原会话");
  }, 30000);
});

describe("explicit successful rehearsal cleanup", () => {
  it("removes only the three known files and preserves backups and unknown files", () => {
    const folder = mkdtempSync(join(directory, "cleanup-"));
    for (const name of ["before.db", "rehearsal.db", "rehearsal.db-wal", "rehearsal.db-shm", "unknown.db", "rehearsal.json"]) writeFileSync(join(folder, name), "synthetic");
    expect(cleanupRehearsal(folder).removed).toEqual(["rehearsal.db-wal", "rehearsal.db-shm", "rehearsal.db"]);
    expect(readdirSync(folder).sort()).toEqual(["before.db", "rehearsal.json", "unknown.db"]);
  });
  it("refuses replaced directories and file links instead of deleting their targets", () => {
    const folder = mkdtempSync(join(directory, "cleanup-links-")), outside = join(directory, "outside.db");
    // Junctions exercise link refusal without requiring Windows symlink privileges.
    mkdirSync(outside); writeFileSync(join(outside, "keep.txt"), "keep"); symlinkSync(outside, join(folder, "rehearsal.db"), "junction");
    expect(cleanupRehearsal(folder).status).toBe("FAILED");
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep");
    const other = mkdtempSync(join(directory, "cleanup-replaced-")); writeFileSync(join(other, "rehearsal.db"), "keep");
    expect(cleanupRehearsal(other, undefined, { dev: -1, ino: -1 }).status).toBe("FAILED");
    expect(readFileSync(join(other, "rehearsal.db"), "utf8")).toBe("keep");
    expect(cleanupRehearsal(join(other, "missing")).status).toBe("FAILED");
  });
});
