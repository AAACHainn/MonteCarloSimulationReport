import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vite 5 predates node:sqlite; use Node's native resolver for this builtin.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("replay session migration", () => {
  it("preserves accounts, trades, annotations and drawings while separating legacy sessions", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync("lib/replay-sessions/fixtures/legacy-schema.sql", "utf8"));
      db.exec("PRAGMA foreign_keys=ON");
      const dataset = db.prepare(`INSERT INTO MarketDataset
        (id,name,symbol,timeframe,timezone,barCount,startTime,endTime,updatedAt)
        VALUES (?,?,'TEST','1m','UTC',4,0,180000,0)`);
      for (const id of ["current", "chart", "history", "empty"]) dataset.run(id, id);
      const journal = db.prepare(`INSERT INTO ReplayJournalSession
        (id,datasetId,name,replayGeneration,initialCapital,currency,commissionBps,slippageBps,archivedAt,updatedAt)
        VALUES (?,?,?,1,10000,'USD',0,0,?,0)`);
      journal.run("journal-current", "current", "原有训练", null);
      journal.run("journal-history", "history", "历史记录", 1234);
      db.exec(`INSERT INTO ReplayProgress (datasetId,startSequence,currentSequence,playbackRate,displayIntervalSeconds,updatedAt)
        VALUES ('current',0,2,10,60,0), ('chart',0,0,2,60,0)`);
      db.exec(`INSERT INTO PaperTradingSession
        (id,datasetId,journalSessionId,initialCapital,currency,lastProcessedSequence,peakEquity,netQuantity,averageEntryPrice,realizedPnl,totalFees,updatedAt)
        VALUES ('account','current','journal-current',10000,'USD',1,10200,2,100,150,3,0)`);
      db.exec(`INSERT INTO PaperOrder (id,sessionId,side,type,quantity,createdSequence,activeFromSequence,updatedAt)
        VALUES ('order','account','BUY','LIMIT',2,0,1,0)`);
      db.exec(`INSERT INTO PaperFill
        (id,sessionId,orderId,sequence,timestamp,side,price,quantity,fee,slippageCost,realizedPnl,closedQuantity,openedQuantity,netQuantityAfter,reason)
        VALUES ('fill','account','order',1,60000,'BUY',100,2,3,0,0,0,2,2,'ENTRY')`);
      db.exec(`INSERT INTO TradeReason (id,name,normalizedName,updatedAt) VALUES ('reason','理由','理由',0)`);
      const entry = db.prepare(`INSERT INTO ReplayJournalEntry
        (id,journalSessionId,no,accountNo,lotId,direction,quantity,openedSequence,openedAt,closedSequence,closedAt,
         entryPrice,exitPrice,abrLength,displayIntervalSeconds,displaySession,displayUtcOffsetMinutes,priceTickSize,initialRisk,actualRisk,gainLoss,review)
        VALUES (?,?,7,1,'lot','LONG',1,0,0,1,60000,100,101,8,60,'ETH',0,0.01,1,1,1,'复盘文字')`);
      entry.run("entry-current", "journal-current");
      entry.run("entry-history", "journal-history");
      db.exec(`INSERT INTO _ReplayJournalTradeReasons (A,B) VALUES ('entry-current','reason')`);
      db.exec(`INSERT INTO MarketDrawing (id,datasetId,type,geometry,style,updatedAt)
        VALUES ('drawing-current','current','TREND_LINE','{}','{}',0), ('drawing-history','history','TREND_LINE','{}','{}',0)`);

      db.exec(readFileSync("prisma/migrations/20261013120000_add_replay_sessions/migration.sql", "utf8"));
      db.exec(readFileSync("prisma/migrations/20261013130000_add_replay_cycles/migration.sql", "utf8"));
      db.exec(readFileSync("prisma/migrations/20261013140000_version_replay_record_ids/migration.sql", "utf8"));
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM ReplaySession").get()).toMatchObject({ n: 4 });
      expect(db.prepare("SELECT mode,status FROM ReplaySession WHERE id='legacy-journal:journal-current'").get())
        .toMatchObject({ mode: "TRAINING", status: "ACTIVE" });
      expect(db.prepare("SELECT currentSequence,playbackRate,replaySessionId FROM ReplayProgress WHERE datasetId='current'").get())
        .toMatchObject({ currentSequence: 1, playbackRate: 10, replaySessionId: "legacy-journal:journal-current" });
      expect(db.prepare("SELECT netQuantity,averageEntryPrice,realizedPnl,totalFees,projectionId FROM PaperTradingSession WHERE projectionId='legacy-projection:legacy-journal:journal-current'").get())
        .toMatchObject({ netQuantity: 2, averageEntryPrice: 100, realizedPnl: 150, totalFees: 3, projectionId: "legacy-projection:legacy-journal:journal-current" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM PaperFill").get()).toMatchObject({ n: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM _ReplayJournalTradeReasons").get()).toMatchObject({ n: 1 });
      expect(db.prepare("SELECT review,no,accountNo,logicalKey FROM ReplayJournalEntry WHERE logicalKey='entry-current'").get())
        .toMatchObject({ review: "复盘文字", no: 7, accountNo: 1, logicalKey: "entry-current" });
      expect(db.prepare("SELECT replaySessionId FROM MarketDrawing WHERE id='drawing-history'").get())
        .toMatchObject({ replaySessionId: "legacy-drawings:history" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM ReplayCommand").get()).toMatchObject({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM ReplayCheckpoint").get()).toMatchObject({ n: 0 });
      // Dataset ownership is no longer unique: two independent accounts can coexist.
      db.exec(`INSERT INTO PaperTradingSession
        (id,datasetId,initialCapital,currency,lastProcessedSequence,peakEquity,updatedAt)
        VALUES ('second-account','current',5000,'USD',0,5000,0)`);
      expect(db.prepare("SELECT COUNT(*) AS n FROM PaperTradingSession WHERE datasetId='current'").get()).toMatchObject({ n: 2 });
    } finally { db.close(); }
  });
});
