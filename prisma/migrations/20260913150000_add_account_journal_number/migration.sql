ALTER TABLE "ReplayJournalSession" ADD COLUMN "nextEntryNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReplayJournalEntry" ADD COLUMN "accountNo" INTEGER NOT NULL DEFAULT 0;

WITH "ranked" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "journalSessionId" ORDER BY "no", "id") AS "accountNo"
  FROM "ReplayJournalEntry"
)
UPDATE "ReplayJournalEntry"
SET "accountNo" = (
  SELECT "ranked"."accountNo"
  FROM "ranked"
  WHERE "ranked"."id" = "ReplayJournalEntry"."id"
);

UPDATE "ReplayJournalSession"
SET "nextEntryNo" = (
  SELECT COALESCE(MAX("accountNo"), 0)
  FROM "ReplayJournalEntry"
  WHERE "ReplayJournalEntry"."journalSessionId" = "ReplayJournalSession"."id"
);

CREATE UNIQUE INDEX "ReplayJournalEntry_journalSessionId_accountNo_key"
ON "ReplayJournalEntry"("journalSessionId", "accountNo");
