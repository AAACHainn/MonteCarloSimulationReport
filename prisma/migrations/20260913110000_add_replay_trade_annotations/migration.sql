ALTER TABLE "PaperPositionLot" ADD COLUMN "entryOrderType" TEXT;
ALTER TABLE "ReplayJournalEntry" ADD COLUMN "entryOrderType" TEXT;

UPDATE "PaperPositionLot"
SET "entryOrderType" = (
  SELECT "PaperOrder"."type"
  FROM "PaperFill"
  INNER JOIN "PaperOrder" ON "PaperOrder"."id" = "PaperFill"."orderId"
  WHERE "PaperFill"."id" = "PaperPositionLot"."entryFillId"
  LIMIT 1
)
WHERE "entryOrderType" IS NULL;

UPDATE "ReplayJournalEntry"
SET "entryOrderType" = (
  SELECT "PaperOrder"."type"
  FROM "PaperFill"
  INNER JOIN "PaperOrder" ON "PaperOrder"."id" = "PaperFill"."orderId"
  WHERE "ReplayJournalEntry"."lotId" = 'lot_' || "PaperFill"."id"
  LIMIT 1
)
WHERE "entryOrderType" IS NULL;

CREATE INDEX "ReplayJournalEntry_journalSessionId_closedSequence_idx"
ON "ReplayJournalEntry"("journalSessionId", "closedSequence");
