-- FK references cascade when primary keys change. Engine/business identities
-- remain the original suffix; numeric trade/account facts are not modified.
UPDATE "PaperTradingSession" SET "id"='projection::'||"projectionId"||'::'||"id"
WHERE "projectionId" IS NOT NULL AND substr("id",1,12)!='projection::';
UPDATE "PaperOrder" SET "id"='projection::'||(SELECT a."projectionId" FROM "PaperTradingSession" a WHERE a."id"="PaperOrder"."sessionId")||'::'||"id"
WHERE substr("id",1,12)!='projection::' AND EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."id"="PaperOrder"."sessionId" AND a."projectionId" IS NOT NULL);
UPDATE "PaperFill" SET "id"='projection::'||(SELECT a."projectionId" FROM "PaperTradingSession" a WHERE a."id"="PaperFill"."sessionId")||'::'||"id"
WHERE substr("id",1,12)!='projection::' AND EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."id"="PaperFill"."sessionId" AND a."projectionId" IS NOT NULL);
UPDATE "PaperTrade" SET "id"='projection::'||(SELECT a."projectionId" FROM "PaperTradingSession" a WHERE a."id"="PaperTrade"."sessionId")||'::'||"id"
WHERE substr("id",1,12)!='projection::' AND EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."id"="PaperTrade"."sessionId" AND a."projectionId" IS NOT NULL);
UPDATE "PaperPositionLot" SET "id"='projection::'||(SELECT a."projectionId" FROM "PaperTradingSession" a WHERE a."id"="PaperPositionLot"."sessionId")||'::'||"id"
WHERE substr("id",1,12)!='projection::' AND EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."id"="PaperPositionLot"."sessionId" AND a."projectionId" IS NOT NULL);
UPDATE "PaperPositionLot" SET "entryFillId"='projection::'||(SELECT a."projectionId" FROM "PaperTradingSession" a WHERE a."id"="PaperPositionLot"."sessionId")||'::'||"entryFillId"
WHERE substr("entryFillId",1,12)!='projection::' AND EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."id"="PaperPositionLot"."sessionId" AND a."projectionId" IS NOT NULL);
UPDATE "ReplayJournalEntry" SET "logicalKey"="id" WHERE "logicalKey" IS NULL;
UPDATE "ReplayJournalEntry" SET "id"='projection::'||"projectionId"||'::'||"id" WHERE "projectionId" IS NOT NULL AND substr("id",1,12)!='projection::';
UPDATE "ReplayJournalEntry" SET "lotId"='projection::'||"projectionId"||'::'||"lotId" WHERE "projectionId" IS NOT NULL AND substr("lotId",1,12)!='projection::';
