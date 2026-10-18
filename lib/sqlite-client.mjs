import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SQLITE_DRIVER_VERSION = "3.51.3";

// Prisma resolves relative SQLite URLs against the schema directory, whereas the JS driver uses cwd.
export function resolveSqlitePath(url, projectRoot = process.cwd()) {
  if (typeof url !== "string" || !url.startsWith("file:") || url.includes("?") || url.includes("#")) {
    throw new Error("Use a SQLite file: URL without query parameters for this driver");
  }
  const name = url.startsWith("file://") ? fileURLToPath(url) : url.slice(5);
  if (!name || name === ":memory:") throw new Error("The configured SQLite runtime requires a file-backed database");
  return isAbsolute(name) ? resolve(name) : resolve(projectRoot, "prisma", name);
}

function hasWalHeader(file) {
  if (!existsSync(file)) return false;
  const handle = openSync(file, "r");
  try {
    const header = Buffer.alloc(20);
    return readSync(handle, header, 0, header.length, 0) === header.length && header[18] === 2;
  } finally { closeSync(handle); }
}

export function createDatabaseClient(options = {}, settings = {}) {
  const env = settings.env ?? process.env;
  const driver = env.SQLITE_DRIVER || "native";
  if (!["native", "better-sqlite3"].includes(driver)) throw new Error("SQLITE_DRIVER must be native or better-sqlite3");
  const url = options.datasourceUrl ?? options.datasources?.db?.url ?? env.DATABASE_URL;
  if (driver === "native") {
    if (env.SQLITE_JOURNAL_MODE && env.SQLITE_JOURNAL_MODE !== "delete") throw new Error("WAL requires SQLITE_DRIVER=better-sqlite3");
    // Do not let the old bundled engine become an accidental writer of the migrated local database.
    if (url && hasWalHeader(resolveSqlitePath(url.split("?")[0], settings.projectRoot))) {
      throw new Error("This database is in WAL mode. Enable SQLITE_DRIVER=better-sqlite3, or stop all services and follow the documented rollback procedure");
    }
    return new PrismaClient(options);
  }
  const file = resolveSqlitePath(url, settings.projectRoot);
  if (!settings.allowCreate && !existsSync(file)) throw new Error("SQLite database file does not exist: " + file);
  const mode = env.SQLITE_JOURNAL_MODE || "wal";
  if (!["wal", "delete"].includes(mode)) throw new Error("SQLITE_JOURNAL_MODE must be wal or delete");
  const factory = new PrismaBetterSQLite3({ url: "file:" + file, fileMustExist: !settings.allowCreate, timeout: 5000 }, { timestampFormat: "unixepoch-ms" });
  const connect = factory.connect.bind(factory);
  factory.connect = async () => {
    const adapter = await connect();
    try {
      const query = sql => adapter.queryRaw({ sql, args: [], argTypes: [] });
      const sqliteVersion = (await query("SELECT sqlite_version()")).rows[0][0];
      if (sqliteVersion !== SQLITE_DRIVER_VERSION) throw new Error("Unvalidated SQLite engine version: " + sqliteVersion);
      await query("PRAGMA foreign_keys=ON");
      const currentMode = (await query("PRAGMA journal_mode")).rows[0][0];
      if (currentMode !== mode) await query("PRAGMA journal_mode=" + mode.toUpperCase());
      await query("PRAGMA synchronous=FULL");
      const journalMode = (await query("PRAGMA journal_mode")).rows[0][0];
      const synchronous = Number((await query("PRAGMA synchronous")).rows[0][0]);
      const foreignKeys = Number((await query("PRAGMA foreign_keys")).rows[0][0]) === 1;
      if (journalMode !== mode || synchronous !== 2 || !foreignKeys) throw new Error("SQLite WAL/FULL/foreign-key configuration did not take effect");
      settings.onConnected?.({ driver, sqliteVersion, journalMode, synchronous, foreignKeys, databasePath: file });
      return adapter;
    } catch (error) { await adapter.dispose(); throw error; }
  };
  const { datasourceUrl, datasources, ...rest } = options;
  void datasourceUrl; void datasources;
  return new PrismaClient({ ...rest, adapter: factory });
}
