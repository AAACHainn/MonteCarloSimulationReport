import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { isSqliteBusy, retrySqliteWrite, sqliteWriteTransaction, SqliteCommitUncertainError, SqliteWriteBusyError } from "./sqlite-write";

const policy = { attempts: 3, budgetMs: 1000, delayMs: 0, maxDelayMs: 0 };
describe("SQLite write retry boundaries", () => {
  it("uses structured busy codes and never retries generic timeouts or message matching", () => {
    expect(isSqliteBusy({ code: "SQLITE_BUSY_SNAPSHOT" })).toBe(true);
    expect(isSqliteBusy({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "517" } } } })).toBe(true);
    for (const error of [{ code: "P1008" }, { code: "P2028" }, { code: "P2002" }, new Error("database is locked")]) expect(isSqliteBusy(error)).toBe(false);
  });
  it("restarts only after the old transaction rolls back, preserving atomic work", async () => {
    const events: string[] = [];
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      events.push("begin");
      try { const value = await work({}); events.push("commit"); return value; }
      catch (error) { events.push("rollback"); throw error; }
    } } as unknown as PrismaClient;
    let calls = 0;
    const result = await sqliteWriteTransaction(db, async () => {
      events.push("read/write");
      if (!calls++) throw { code: "SQLITE_BUSY_SNAPSHOT" };
      return "saved";
    }, undefined, policy);
    expect(result).toBe("saved");
    expect(events).toEqual(["begin", "read/write", "rollback", "begin", "read/write", "commit"]);
  });
  it("never replays a callback when COMMIT did not confirm the result", async () => {
    const work = vi.fn(async () => "saved");
    const db = { $transaction: async (callback: (tx: unknown) => Promise<unknown>) => { await callback({}); throw { code: "SQLITE_BUSY" }; } } as unknown as PrismaClient;
    await expect(sqliteWriteTransaction(db, work, undefined, policy)).rejects.toBeInstanceOf(SqliteCommitUncertainError);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("bounds attempts and does not retry deterministic business errors", async () => {
    const busy = vi.fn(async () => { throw { code: "SQLITE_BUSY" }; });
    await expect(retrySqliteWrite(busy, policy)).rejects.toBeInstanceOf(SqliteWriteBusyError);
    expect(busy).toHaveBeenCalledTimes(3);
    const bad = vi.fn(async () => { throw new Error("invalid source"); });
    await expect(retrySqliteWrite(bad, policy)).rejects.toThrow("invalid source");
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
