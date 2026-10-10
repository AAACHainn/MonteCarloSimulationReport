import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseFile = join(tmpdir(), `review-limit-${randomUUID()}.db`);
const prisma = new PrismaClient({ datasourceUrl: `file:${databaseFile}` });
const originalReview = "入场依据：\n  顺势交易 😀\n";

function initialize() {
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], {
    env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe",
  });
}

beforeAll(async () => {
  initialize();
  await prisma.marketDataset.create({ data: {
    id: "dataset-1", name: "回放练习", symbol: "ES", timeframe: "5m", timezone: "UTC",
    barCount: 1, startTime: new Date(), endTime: new Date(),
  } });
  await prisma.replayJournalSession.create({ data: {
    id: "session-1", datasetId: "dataset-1", name: "历史记录", replayGeneration: 1,
    initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0,
  } });
  await prisma.replayJournalEntry.create({ data: {
    id: "entry-1", journalSession: { connect: { id: "session-1" } }, no: 1, accountNo: 1, lotId: "lot-1",
    direction: "LONG", quantity: 1, openedSequence: 0, openedAt: new Date(),
    closedSequence: 1, closedAt: new Date(), entryPrice: 100, exitPrice: 101,
    abrLength: 8, displayIntervalSeconds: 300, displaySession: "ETH", displayUtcOffsetMinutes: 0,
    priceTickSize: 0.25, initialRisk: 1, actualRisk: 1, gainLoss: 1, review: originalReview,
    setupOption: { create: { id: "setup-1", type: "STRATEGY", name: "突破" } },
    tradeReasons: { create: { id: "reason-1", name: "顺势", normalizedName: "顺势" } },
  } });
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  unlinkSync(databaseFile);
});

async function checkLimit() {
  const review = "复盘\n😀".repeat(500);
  const updated = await prisma.replayJournalEntry.update({ where: { id: "entry-1" }, data: { review } });
  expect(updated.review).toBe(review);
  await expect(prisma.replayJournalEntry.update({
    where: { id: "entry-1" }, data: { review: review + "字" },
  })).rejects.toThrow();
  await prisma.replayJournalEntry.update({ where: { id: "entry-1" }, data: { review: originalReview } });
}

describe("review length SQLite compatibility", () => {
  it("enforces the 2000-character limit in a newly initialized database", checkLimit);

  it.each(["migration", "initializer"])("upgrades the old constraint without losing content or relations (%s)", async (method) => {
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`ALTER TABLE "ReplayJournalEntry" ADD COLUMN "review_legacy" TEXT NOT NULL DEFAULT '' CHECK(length("review_legacy") <= 300)`),
      prisma.$executeRawUnsafe(`UPDATE "ReplayJournalEntry" SET "review_legacy" = "review"`),
      prisma.$executeRawUnsafe(`ALTER TABLE "ReplayJournalEntry" DROP COLUMN "review"`),
      prisma.$executeRawUnsafe(`ALTER TABLE "ReplayJournalEntry" RENAME COLUMN "review_legacy" TO "review"`),
    ]);
    if (method === "initializer") {
      initialize();
      initialize(); // The fallback initializer must remain safe to run again.
    } else {
      const statements = readFileSync("prisma/migrations/20261010120000_expand_replay_journal_review/migration.sql", "utf8")
        .replace(/^--.*$/gm, "").split(";").map((statement) => statement.trim())
        .filter((statement) => statement && statement !== "BEGIN TRANSACTION" && statement !== "COMMIT");
      await prisma.$transaction(statements.map((statement) => prisma.$executeRawUnsafe(statement)));
    }
    const saved = await prisma.replayJournalEntry.findUniqueOrThrow({
      where: { id: "entry-1" }, include: { setupOption: true, tradeReasons: true, journalSession: true },
    });
    expect(saved.review).toBe(originalReview);
    expect(saved.journalSession.id).toBe("session-1");
    expect(saved.setupOption?.id).toBe("setup-1");
    expect(saved.tradeReasons.map((reason) => reason.id)).toEqual(["reason-1"]);
    expect(await prisma.$queryRawUnsafe(`PRAGMA foreign_key_check`)).toEqual([]);
    await checkLimit();
  }, 30000);
});
