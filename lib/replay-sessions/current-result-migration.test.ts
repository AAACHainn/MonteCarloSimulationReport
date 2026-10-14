import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("single replay result migration", () => {
  it("removes old accounts and records while preserving accepted results, archives and a pending preview", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync("lib/replay-sessions/fixtures/legacy-schema.sql", "utf8"));
      for (const migration of ["20261013120000_add_replay_sessions", "20261013130000_add_replay_cycles", "20261013140000_version_replay_record_ids"]) {
        db.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
      }
      db.exec("PRAGMA foreign_keys=ON");
      db.exec(`INSERT INTO MarketDataset (id,name,symbol,timeframe,timezone,barCount,startTime,endTime,updatedAt)
        VALUES ('data','TEST','TEST','1m','UTC',4,0,180000,0);
        INSERT INTO ReplaySession (id,datasetId,name,mode,status,updatedAt)
        VALUES ('live','data','实盘','LIVE_REPLAY','ACTIVE',0), ('archive','data','已归档训练','TRAINING','ARCHIVED',0);
        INSERT INTO ReplayProjection (id,replaySessionId,generation,status,historyVersion,currentSequence,parentId)
        VALUES ('old','live',1,'HISTORICAL',1,3,NULL), ('current','live',2,'CURRENT',1,3,'old'),
               ('failed','live',3,'FAILED',1,1,'current'), ('draft','live',3,'BUILDING',1,1,'current'),
               ('archive-old','archive',1,'HISTORICAL',1,3,NULL), ('archive-current','archive',2,'CURRENT',1,3,'archive-old');
        UPDATE ReplaySession SET activeProjectionId='current',pendingCorrectionId='preview' WHERE id='live';
        UPDATE ReplaySession SET activeProjectionId='archive-current' WHERE id='archive';
        INSERT INTO ReplayCorrectionJob (id,replaySessionId,type,status,baseProjectionId,targetProjectionId,targetSequence,expectedVersion,historyVersion,updatedAt)
        VALUES ('preview','live','REWIND','READY','current','draft',1,1,1,0),
               ('applied','live','REWIND','APPLIED','old','current',3,1,1,0),
               ('canceled','live','REWIND','CANCELLED','current','failed',1,1,1,0);
        INSERT INTO ReplayJournalSession (id,datasetId,replaySessionId,name,replayGeneration,initialCapital,currency,commissionBps,slippageBps,updatedAt)
        VALUES ('journal','data','live','正确记录',2,10000,'USD',0,0,0);
        INSERT INTO TradeReason (id,name,normalizedName,updatedAt) VALUES ('reason','顺势','顺势',0);`);
      const account = db.prepare(`INSERT INTO PaperTradingSession
        (id,datasetId,projectionId,journalSessionId,initialCapital,currency,lastProcessedSequence,peakEquity,realizedPnl,updatedAt)
        VALUES (?,'data',?,'journal',10000,'USD',3,10123,123,0)`);
      const order = db.prepare(`INSERT INTO PaperOrder (id,sessionId,side,type,quantity,createdSequence,activeFromSequence,updatedAt)
        VALUES (?,?,'BUY','MARKET',1,0,1,0)`);
      const fill = db.prepare(`INSERT INTO PaperFill
        (id,sessionId,orderId,sequence,timestamp,side,price,quantity,fee,slippageCost,realizedPnl,closedQuantity,openedQuantity,netQuantityAfter,reason)
        VALUES (?,?,?,1,60000,'BUY',100,1,0,0,0,0,1,1,'ENTRY')`);
      const entry = db.prepare(`INSERT INTO ReplayJournalEntry
        (id,journalSessionId,projectionId,logicalKey,no,accountNo,lotId,direction,quantity,openedSequence,openedAt,closedSequence,closedAt,
        entryPrice,exitPrice,abrLength,displayIntervalSeconds,displaySession,displayUtcOffsetMinutes,priceTickSize,initialRisk,actualRisk,gainLoss,review)
        VALUES (?,'journal',?,'logical-trade',7,1,'lot','LONG',1,0,0,1,60000,100,101,8,60,'ETH',0,0.01,1,1,1,'当前复盘备注')`);
      for (const id of ["old", "current", "failed", "draft"]) {
        account.run(`account-${id}`, id); order.run(`order-${id}`, `account-${id}`);
        fill.run(`fill-${id}`, `account-${id}`, `order-${id}`); entry.run(`entry-${id}`, id);
        db.prepare("INSERT INTO _ReplayJournalTradeReasons (A,B) VALUES (?,'reason')").run(`entry-${id}`);
        db.prepare("INSERT INTO ReplayCheckpoint (id,projectionId,sourceSequence,state) VALUES (?,?,0,'{}')").run(`checkpoint-${id}`, id);
        db.prepare("INSERT INTO ReplayContextRun (id,projectionId,fromSequence,toSequence,context) VALUES (?,?,0,3,'{}')").run(`context-${id}`, id);
      }
      db.exec(`INSERT INTO ReplayCommand (id,replaySessionId,sourceSequence,ordinal,type,payload)
        VALUES ('shared','live',0,1,'ACCOUNT_INIT','{}'), ('removed','live',1,1,'ORDER_CREATE','{}'),
               ('draft-only','live',1,2,'ORDER_CANCEL','{}'), ('orphan','live',1,3,'ORDER_CANCEL','{}');
        INSERT INTO ReplayProjectionCommand (projectionId,commandId)
        VALUES ('old','shared'), ('current','shared'), ('draft','shared'), ('old','removed'), ('draft','draft-only');`);
      const expectedAccount = db.prepare("SELECT * FROM PaperTradingSession WHERE projectionId='current'").get();
      const expectedEntry = db.prepare("SELECT * FROM ReplayJournalEntry WHERE projectionId='current'").get();

      db.exec("BEGIN");
      db.exec(readFileSync("prisma/migrations/20261014120000_keep_current_replay_result/migration.sql", "utf8"));
      db.exec("COMMIT");
      expect(db.prepare("SELECT id FROM ReplayProjection ORDER BY id").all()).toEqual([
        { id: "archive-current" }, { id: "current" }, { id: "draft" },
      ]);
      expect(db.prepare("SELECT * FROM PaperTradingSession WHERE projectionId='current'").get()).toEqual(expectedAccount);
      expect(db.prepare("SELECT * FROM ReplayJournalEntry WHERE projectionId='current'").get()).toEqual(expectedEntry);
      for (const table of ["PaperTradingSession", "PaperOrder", "PaperFill", "ReplayJournalEntry", "ReplayCheckpoint", "ReplayContextRun", "_ReplayJournalTradeReasons"]) {
        expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 2 });
      }
      expect(db.prepare("SELECT id FROM ReplayCommand ORDER BY id").all()).toEqual([{ id: "draft-only" }, { id: "shared" }]);
      expect(db.prepare("SELECT targetProjectionId FROM ReplayCorrectionJob WHERE id='canceled'").get()).toEqual({ targetProjectionId: null });
      expect(db.prepare("SELECT activeProjectionId,status FROM ReplaySession WHERE id='archive'").get()).toEqual({ activeProjectionId: "archive-current", status: "ARCHIVED" });
      const columns = db.prepare("PRAGMA table_info(ReplayProjection)").all().map((column) => column.name);
      expect(columns).not.toContain("generation"); expect(columns).not.toContain("parentId");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() => db.exec(`INSERT INTO ReplayProjection (id,replaySessionId,status,historyVersion,currentSequence)
        VALUES ('duplicate','live','CURRENT',1,3)`)).toThrow();
    } finally { db.close(); }
  });
});
