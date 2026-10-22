import type { Prisma, PrismaClient } from "@prisma/client";

type RetryPolicy = { attempts: number; budgetMs: number; delayMs: number; maxDelayMs: number };
export const backgroundWritePolicy: RetryPolicy = { attempts: 8, budgetMs: 30000, delayMs: 50, maxDelayMs: 1000 };
const foregroundWritePolicy: RetryPolicy = { attempts: 5, budgetMs: 1500, delayMs: 15, maxDelayMs: 150 };
export const sqlitePause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Codes only: a Prisma timeout or an error containing "locked" is not proof of rollback. */
export function isSqliteBusy(error: unknown): boolean {
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): boolean {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return false;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_BUSY_RECOVERY"].includes(String(record.code))
      || ["5", "261", "517"].includes(String(record.code))
      || ["5", "261", "517"].includes(String(record.extendedCode ?? record.originalCode))) return true;
    return ["cause", "meta", "driverAdapterError", "error"].some((key) => inspect(record[key], depth + 1));
  }
  return inspect(error, 0);
}

export class SqliteWriteBusyError extends Error {
  readonly code = "DATABASE_BUSY";
  constructor(cause: unknown) { super("DATABASE_BUSY", { cause }); }
}

/** The transaction callback returned but COMMIT did not confirm success. Never replay it. */
export class SqliteCommitUncertainError extends Error {
  readonly code = "DATABASE_COMMIT_UNCERTAIN";
  constructor(cause: unknown) { super("DATABASE_COMMIT_UNCERTAIN", { cause }); }
}

/** Only for a single atomic SQL statement, or an operation known to have rolled back. */
export async function retrySqliteWrite<T>(action: () => Promise<T>, policy = foregroundWritePolicy): Promise<T> {
  const started = performance.now();
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (error instanceof SqliteCommitUncertainError || !isSqliteBusy(error)) throw error;
      const remaining = policy.budgetMs - (performance.now() - started);
      if (attempt + 1 >= policy.attempts || remaining <= 0) throw new SqliteWriteBusyError(error);
      const delay = Math.min(policy.maxDelayMs, policy.delayMs * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      if (delay >= remaining) throw new SqliteWriteBusyError(error);
      await sqlitePause(delay);
    }
  }
}

/** Retrying the callback is safe only after $transaction has rejected and rolled it back.
 * Keep network, file writes, emitted events and mutations of external state outside work.
 */
export function sqliteWriteTransaction<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number; writeFence?: boolean },
  policy = foregroundWritePolicy,
): Promise<T> {
  const started = performance.now();
  return retrySqliteWrite(async () => {
    let callbackReturned = false;
    try {
      const remaining = Math.max(1, Math.floor(policy.budgetMs - (performance.now() - started)));
      return await db.$transaction(async (tx) => {
        // All initialized application databases contain MarketDataset. WHERE 0 changes no
        // records, timestamps or leases, but obtains the SQLite write slot before reads.
        // Background jobs supply their own owner-qualified first statement instead.
        if ((options?.writeFence ?? policy !== backgroundWritePolicy) && tx.$executeRaw) {
          await tx.$executeRaw`UPDATE "MarketDataset" SET "id" = "id" WHERE 0`;
        }
        const result = await work(tx);
        callbackReturned = true;
        return result;
      }, { maxWait: Math.min(options?.maxWait ?? remaining, remaining), timeout: options?.timeout ?? 30000 });
    } catch (error) {
      if (callbackReturned) throw new SqliteCommitUncertainError(error);
      throw error;
    }
  }, policy);
}
