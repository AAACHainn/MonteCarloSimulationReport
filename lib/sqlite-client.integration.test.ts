import { isSqliteBusy } from "./sqlite-write";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseClient, resolveSqlitePath } from "./sqlite-client.mjs";
import type { PrismaClient } from "@prisma/client";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const clients: PrismaClient[] = [];
const files: string[] = [];
function file() { const path = join(tmpdir(), "sqlite-client-" + randomUUID() + ".db"); files.push(path); return path; }
function client(path: string, mode: "wal" | "delete" = "wal", allowCreate = true, synchronous = "FULL") {
  const value = createDatabaseClient({ datasourceUrl: "file:" + path }, { env: { SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: mode, SQLITE_SYNCHRONOUS: synchronous }, allowCreate });
  clients.push(value); return value;
}
afterEach(async () => {
  for (const value of clients.splice(0)) await value.$disconnect();
  for (const path of files.splice(0)) if (existsSync(path)) rmSync(path);
});
describe("configured SQLite runtime", () => {
  it("resolves relative URLs against prisma/ and retains absolute paths and spaces", () => {
    const root = resolve(tmpdir(), "sqlite-project");
    expect(resolveSqlitePath("file:./dev.db", root)).toBe(join(root, "prisma", "dev.db"));
    const path = file().replace(".db", " with spaces.db");
    expect(resolveSqlitePath("file:" + path)).toBe(path);
    expect(resolveSqlitePath(pathToFileURL(path).href)).toBe(path);
    expect(() => resolveSqlitePath("file:./dev.db?connection_limit=1")).toThrow();
  });
  it("refuses invalid driver settings and missing databases rather than creating an empty runtime database", async () => {
    expect(() => createDatabaseClient({}, { env: { SQLITE_DRIVER: "unknown" } })).toThrow("SQLITE_DRIVER");
    expect(() => createDatabaseClient({}, { env: { SQLITE_DRIVER: "native", SQLITE_JOURNAL_MODE: "wal" } })).toThrow("WAL requires");
    const path = file();
    expect(() => client(path, "wal", false)).toThrow("does not exist");
    expect(existsSync(path)).toBe(false);
  });
  it("applies the fixed engine, WAL, FULL and foreign keys on each independently opened connection", async () => {
    const path = file(); const first = client(path);
    expect(await first.$queryRawUnsafe("SELECT sqlite_version() AS version")).toEqual([{ version: "3.51.3" }]);
    const second = client(path);
    for (const db of [first, second]) {
      expect(await db.$queryRawUnsafe("PRAGMA journal_mode")).toEqual([{ journal_mode: "wal" }]);
      expect(Number((await db.$queryRawUnsafe<Array<{ synchronous: number }>>("PRAGMA synchronous"))[0].synchronous)).toBe(2);
      expect(Number((await db.$queryRawUnsafe<Array<{ foreign_keys: number }>>("PRAGMA foreign_keys"))[0].foreign_keys)).toBe(1);
    }
  });
  it("defaults to FULL unless NORMAL is explicitly configured", async () => {
    const db = createDatabaseClient({ datasourceUrl: "file:" + file() }, {
      env: { SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal" }, allowCreate: true,
    });
    clients.push(db);
    expect(Number((await db.$queryRawUnsafe<Array<{ synchronous: number }>>("PRAGMA synchronous"))[0].synchronous)).toBe(2);
  });
  it("applies WAL NORMAL and foreign keys on every independently opened connection", async () => {
    const path = file();
    for (const db of [client(path, "wal", true, "NORMAL"), client(path, "wal", true, "NORMAL")]) {
      expect(await db.$queryRawUnsafe("PRAGMA journal_mode")).toEqual([{ journal_mode: "wal" }]);
      expect(Number((await db.$queryRawUnsafe<Array<{ synchronous: number }>>("PRAGMA synchronous"))[0].synchronous)).toBe(1);
      expect(Number((await db.$queryRawUnsafe<Array<{ foreign_keys: number }>>("PRAGMA foreign_keys"))[0].foreign_keys)).toBe(1);
    }
  });
  it("rejects unsupported sync levels and NORMAL without WAL before creating a database", () => {
    for (const synchronous of ["OFF", "EXTRA", "normal", "1"]) {
      const path = file();
      expect(() => client(path, "wal", true, synchronous)).toThrow("SQLITE_SYNCHRONOUS must be FULL or NORMAL");
      expect(existsSync(path)).toBe(false);
    }
    const path = file();
    expect(() => client(path, "delete", true, "NORMAL")).toThrow("requires WAL");
    expect(existsSync(path)).toBe(false);
    expect(() => createDatabaseClient({}, { env: { SQLITE_DRIVER: "native", SQLITE_SYNCHRONOUS: "NORMAL" } })).toThrow("requires SQLITE_DRIVER=better-sqlite3");
  });
  it.each(["FULL", "NORMAL"])("preserves millisecond dates and rolls back failed writes with %s", async synchronous => {
    const path = file(); const db = client(path, "wal", true, synchronous);
    await db.$executeRawUnsafe('CREATE TABLE AiSetting (id TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updatedAt DATETIME NOT NULL)');
    const date = new Date("2026-10-18T01:02:03.123Z");
    await db.aiSetting.create({ data: { id: "kept", value: "test", updatedAt: date } });
    await expect(db.$transaction(async tx => { await tx.aiSetting.create({ data: { id: "rolled-back", value: "test", updatedAt: date } }); throw new Error("expected rollback"); })).rejects.toThrow("expected rollback");
    await db.$disconnect();
    const reopened = client(path, "wal", false, synchronous);
    expect((await reopened.aiSetting.findUniqueOrThrow({ where: { id: "kept" } })).updatedAt.toISOString()).toBe(date.toISOString());
    expect(await reopened.aiSetting.count()).toBe(1);
    await reopened.$disconnect();
    const raw = new DatabaseSync(path, { readOnly: true });
    try { expect(raw.prepare("SELECT typeof(updatedAt) AS storage FROM AiSetting").get()?.storage).toBe("integer"); } finally { raw.close(); }
  });
  it("enforces foreign keys during transaction writes", async () => {
    const db = client(file());
    await db.$executeRawUnsafe("CREATE TABLE Parent (id INTEGER PRIMARY KEY)");
    await db.$executeRawUnsafe("CREATE TABLE Child (id INTEGER PRIMARY KEY, parentId INTEGER REFERENCES Parent(id))");
    await expect(db.$executeRawUnsafe("INSERT INTO Child VALUES (1, 999)")).rejects.toThrow();
    expect(await db.$queryRawUnsafe("SELECT COUNT(*) AS count FROM Child")).toEqual([{ count: BigInt(0) }]);
  });
  it("blocks accidental old-engine WAL writes and allows explicit offline conversion back to DELETE", async () => {
    const path = file(); const db = client(path); await db.$queryRawUnsafe("SELECT 1"); await db.$disconnect();
    expect(() => createDatabaseClient({ datasourceUrl: "file:" + path }, { env: { SQLITE_DRIVER: "native" } })).toThrow("WAL mode");
    const rollback = client(path, "delete", false); await rollback.$queryRawUnsafe("SELECT 1"); await rollback.$disconnect();
    const original = createDatabaseClient({ datasourceUrl: "file:" + path }, { env: { SQLITE_DRIVER: "native" } }); clients.push(original);
    expect(await original.$queryRawUnsafe("PRAGMA journal_mode")).toEqual([{ journal_mode: "delete" }]);
  });
  it("preserves primary SQLITE_BUSY as a structured code instead of an incompatible SocketTimeout", async () => {
    const path = file(), db = client(path);
    await db.$executeRawUnsafe("CREATE TABLE BusyProbe (id INTEGER PRIMARY KEY, value TEXT)");
    await db.$executeRawUnsafe("INSERT INTO BusyProbe VALUES (1, 'original')");
    await db.$queryRawUnsafe("PRAGMA busy_timeout=5");
    const blocker = new DatabaseSync(path);
    try {
      blocker.exec("BEGIN IMMEDIATE");
      let error: unknown;
      try { await db.$executeRawUnsafe("UPDATE BusyProbe SET value = 'blocked' WHERE id=1"); } catch (caught) { error = caught; }
      expect(error).toBeDefined(); expect(isSqliteBusy(error)).toBe(true);
      expect((error as { meta?: { code?: string } }).meta?.code).toBe("5");
      blocker.exec("ROLLBACK");
      await db.$executeRawUnsafe("UPDATE BusyProbe SET value = 'saved' WHERE id=1");
      expect(await db.$queryRawUnsafe("SELECT value FROM BusyProbe")).toEqual([{ value: "saved" }]);
    } finally { if (blocker.isTransaction) blocker.exec("ROLLBACK"); blocker.close(); }
  });
  it.each(["FULL", "NORMAL"])("propagates the fixed driver and %s setting to an independent Node worker", async synchronous => {
    const path = file(); const db = client(path); await db.$queryRawUnsafe("SELECT 1"); await db.$disconnect();
    const script = [
      'import { createDatabaseClient } from "./lib/sqlite-client.mjs";',
      'const db = createDatabaseClient();',
      'try { console.log(JSON.stringify({ version: await db.$queryRawUnsafe("SELECT sqlite_version() AS version"), mode: await db.$queryRawUnsafe("PRAGMA journal_mode"), sync: await db.$queryRawUnsafe("PRAGMA synchronous") }, (_key,value) => typeof value === "bigint" ? Number(value) : value)); } finally { await db.$disconnect(); }',
    ].join("\n");
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      env: { ...process.env, DATABASE_URL: "file:" + path, SQLITE_DRIVER: "better-sqlite3", SQLITE_JOURNAL_MODE: "wal", SQLITE_SYNCHRONOUS: synchronous },
    }));
    expect(result).toEqual({ version: [{ version: "3.51.3" }], mode: [{ journal_mode: "wal" }], sync: [{ synchronous: synchronous === "NORMAL" ? 1 : 2 }] });
  });

});
