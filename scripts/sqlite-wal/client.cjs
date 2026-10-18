/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is required by the isolated Node --require preload. */
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const candidateDirectory = path.join(root, "tmp/sqlite-wal-candidate");
const reportDirectory = path.join(root, "tmp/sqlite-wal-validation");

function isolatedDatabasePath(url) {
  if (typeof url !== "string" || !url.startsWith("file:") || url.includes("?")) {
    throw new Error("SQLite validation requires an explicit file URL without parameters");
  }
  const file = url.slice(5);
  if (!path.isAbsolute(file)) throw new Error("SQLite validation requires an absolute database path");
  const resolved = path.resolve(file);
  const comparison = value => process.platform === "win32" ? value.toLowerCase() : value;
  const temporaryFixture = comparison(path.dirname(resolved)) === comparison(path.resolve(os.tmpdir()))
    && /^(replay-integration-|replay-sessions-|training-gate-|sqlite-wal-benchmark-)[\w-]+\.db$/.test(path.basename(resolved));
  const relative = path.relative(reportDirectory, resolved);
  const isolatedCopy = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (!temporaryFixture && !isolatedCopy) throw new Error("Refusing a database outside the isolated validation paths");
  return resolved;
}

function candidateFactory(file, mode) {
  if (!["delete", "wal"].includes(mode)) throw new Error("Unknown SQLite validation journal mode");
  const candidateRequire = createRequire(path.join(candidateDirectory, "package.json"));
  const { PrismaBetterSQLite3 } = candidateRequire("@prisma/adapter-better-sqlite3");
  if (candidateRequire("better-sqlite3/package.json").version !== "12.8.0") throw new Error("Candidate driver version changed");
  const factory = new PrismaBetterSQLite3({ url: "file:" + isolatedDatabasePath("file:" + file) }, { timestampFormat: "unixepoch-ms" });
  const connect = factory.connect.bind(factory);
  factory.connect = async () => {
    const adapter = await connect();
    try {
      const query = sql => adapter.queryRaw({ sql, args: [], argTypes: [] });
      const version = (await query("SELECT sqlite_version()")).rows[0][0];
      if (version !== "3.51.3") throw new Error("Candidate SQLite version changed: " + version);
      await query("PRAGMA foreign_keys=ON");
      const current = (await query("PRAGMA journal_mode")).rows[0][0];
      if (current !== mode) await query("PRAGMA journal_mode=" + mode.toUpperCase());
      await query("PRAGMA synchronous=FULL");
      const actualMode = (await query("PRAGMA journal_mode")).rows[0][0];
      const synchronous = Number((await query("PRAGMA synchronous")).rows[0][0]);
      if (actualMode !== mode || synchronous !== 2) throw new Error("Candidate durability settings were not applied");
      if (process.env.SQLITE_WAL_VALIDATION_TRACE === "1") {
        fs.mkdirSync(reportDirectory, { recursive: true });
        fs.appendFileSync(path.join(reportDirectory, "connections.jsonl"), JSON.stringify({ pid: process.pid, file: path.basename(file), version, mode: actualMode, synchronous }) + "\n");
      }
      return adapter;
    } catch (error) {
      await adapter.dispose();
      throw error;
    }
  };
  return factory;
}

function validationClientClass(Original, mode, applicationFactory) {
  if (!["native-delete", "delete", "wal"].includes(mode)) throw new Error("Set SQLITE_WAL_VALIDATION_MODE to native-delete, delete or wal");
  return class ValidationPrismaClient extends Original {
    constructor(options = {}) {
      const url = options.datasourceUrl ?? options.datasources?.db?.url ?? process.env.DATABASE_URL;
      const file = isolatedDatabasePath(url);
      if (mode === "native-delete") { super(options); return; }
      if (applicationFactory) {
        const { datasourceUrl, datasources, ...rest } = options;
        void datasourceUrl; void datasources;
        return applicationFactory({ ...rest, datasourceUrl: "file:" + file }, {
          env: { ...process.env, SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: mode }, allowCreate: true,
        });
      }
      const { datasourceUrl, datasources, ...rest } = options;
      void datasourceUrl; void datasources;
      super({ ...rest, adapter: candidateFactory(file, mode) });
    }
  };
}
module.exports = { root, candidateDirectory, reportDirectory, isolatedDatabasePath, candidateFactory, validationClientClass };
