import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("prop round migration", () => {
  it("adds initial rounds without changing old account state, session status, progress or payouts", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE ReplaySession (id TEXT PRIMARY KEY,activeProjectionId TEXT,trainingGate TEXT,createdAt INTEGER,updatedAt INTEGER,status TEXT);
        CREATE TABLE ReplayProgress (replaySessionId TEXT,startSequence INTEGER,currentSequence INTEGER);
        CREATE TABLE ReplayProjection (id TEXT PRIMARY KEY);
        CREATE TABLE PropPracticeAccount (replaySessionId TEXT PRIMARY KEY,snapshot TEXT,state TEXT);
        CREATE TABLE PropPracticePayout (id TEXT PRIMARY KEY,amount REAL,received REAL);
        CREATE TABLE PropPracticeEvent (id TEXT PRIMARY KEY,type TEXT);
        INSERT INTO ReplayProjection VALUES ('active-result'),('failed-result');
        INSERT INTO ReplaySession VALUES ('active','active-result','{"completedCount":3}',10,20,'ACTIVE'),('failed','failed-result','{"lossStreak":1}',30,40,'ARCHIVED');
        INSERT INTO ReplayProgress VALUES ('active',5,10),('failed',11,15);
        INSERT INTO PropPracticeAccount VALUES ('active','{"rules":{}}','{"phase":"EVALUATION","result":null}'),('failed','{"rules":{}}','{"phase":"FUNDED","result":"FAILED"}');
        INSERT INTO PropPracticePayout VALUES ('paid',500,450);
        INSERT INTO PropPracticeEvent VALUES ('failed-event','FAILED');`);
      const sessions = db.prepare("SELECT * FROM ReplaySession ORDER BY id").all();
      const progress = db.prepare("SELECT * FROM ReplayProgress ORDER BY replaySessionId").all();
      db.exec("BEGIN");
      db.exec(readFileSync("prisma/migrations/20261024090000_prop_practice_rounds/migration.sql", "utf8"));
      db.exec("COMMIT");
      expect(db.prepare("SELECT * FROM ReplaySession ORDER BY id").all()).toEqual(sessions);
      expect(db.prepare("SELECT * FROM ReplayProgress ORDER BY replaySessionId").all()).toEqual(progress);
      expect(db.prepare("SELECT number,projectionId,startSequence,endSequence,endedAt FROM PropPracticeRound ORDER BY replaySessionId").all()).toEqual([
        { number: 1, projectionId: "active-result", startSequence: 5, endSequence: null, endedAt: null },
        { number: 1, projectionId: "failed-result", startSequence: 11, endSequence: 15, endedAt: 40 },
      ]);
      expect(db.prepare("SELECT amount,received,roundNumber FROM PropPracticePayout").get()).toEqual({ amount: 500, received: 450, roundNumber: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
