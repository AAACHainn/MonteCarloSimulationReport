import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getReplayScope, ReplaySessionError } from "@/lib/replay-sessions/scope";

/** Rank the full result before applying chart windows, filters or pagination. */
export async function withReplayJournalDisplayNumbers<T extends { id: string; accountNo: number }>(
  entries: T[], projectionId = getReplayScope()?.projectionId, db: Prisma.TransactionClient = prisma,
): Promise<T[]> {
  // Unscoped internal legacy readers keep their original identity semantics.
  if (!entries.length || !projectionId) return entries;
  const scope = getReplayScope();
  const projections = scope?.projectionId === projectionId ? scope.journalProjectionIds ?? [projectionId] : [projectionId];
  const rows = scope?.accountCategory !== "PROP_PRACTICE" ? await db.$queryRaw<Array<{ id: string; displayNo: bigint | number; roundNumber?: number | null }>>`
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY journalSessionId ORDER BY accountNo ASC, id ASC
    ) AS displayNo
    FROM ReplayJournalEntry WHERE projectionId = ${projectionId}
  ` : await db.$queryRaw<Array<{ id: string; displayNo: bigint | number; roundNumber?: number | null }>>`
    SELECT e.id, r.number AS roundNumber, ROW_NUMBER() OVER (
      PARTITION BY e.journalSessionId ORDER BY e.accountNo ASC, e.id ASC
    ) AS displayNo
    FROM ReplayJournalEntry e LEFT JOIN PropPracticeRound r ON r.projectionId=e.projectionId
    WHERE e.projectionId IN (${Prisma.join(projections)})
  `;
  const numbers = new Map(rows.map((row) => [row.id, row]));
  return entries.map((entry) => {
    const row = numbers.get(entry.id);
    if (row === undefined) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    // Only the read model changes. Stored IDs, numbering and associations stay stable.
    return { ...entry, accountNo: Number(row.displayNo), ...(row.roundNumber ? { propRoundNumber: row.roundNumber } : {}) };
  });
}
