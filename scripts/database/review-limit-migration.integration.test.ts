import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseFile = join(tmpdir(), `review-limit-${randomUUID()}.db`);
const prisma = new PrismaClient({ datasourceUrl: `file:${databaseFile}` });
const originalReview = "入场依据：\n  顺势交易 😀\n";

function initialize() {
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], {
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

describe("current review length SQLite constraint", () => {
  it("enforces the 2000-character limit in a newly initialized database", checkLimit);
});
