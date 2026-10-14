import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getReplayScope, ReplaySessionError } from "@/lib/replay-sessions/scope";

/** Rank the full result before applying chart windows, filters or pagination. */
export async function withReplayJournalDisplayNumbers<T extends { id: string; accountNo: number }>(
  entries: T[], projectionId = getReplayScope()?.projectionId, db: Prisma.TransactionClient = prisma,
): Promise<T[]> {
  // Unscoped internal legacy readers keep their original identity semantics.
  if (!entries.length || !projectionId) return entries;
  const rows = await db.$queryRaw<Array<{ id: string; displayNo: bigint | number }>>`
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY journalSessionId ORDER BY accountNo ASC, id ASC
    ) AS displayNo
    FROM ReplayJournalEntry WHERE projectionId = ${projectionId}
  `;
  const numbers = new Map(rows.map((row) => [row.id, Number(row.displayNo)]));
  return entries.map((entry) => {
    const accountNo = numbers.get(entry.id);
    if (accountNo === undefined) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    // Only the read model changes. Stored IDs, numbering and associations stay stable.
    return { ...entry, accountNo };
  });
}
