import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateJournalTrade } from "@/lib/trade-journal/calculations";
import { readTradeJournalBackup } from "@/lib/trade-journal/backup";
import { removeJournalScreenshots, writeScreenshotBuffer } from "@/lib/trade-journal/storage";

async function getImportedJournalName(name: string) {
  let candidate = `${name}（导入）`;
  let suffix = 2;
  while (await prisma.tradeJournal.findFirst({ where: { name: candidate }, select: { id: true } })) {
    candidate = `${name}（导入 ${suffix}）`;
    suffix += 1;
  }
  return candidate;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 ZIP 备份。" }, { status: 400 });
  }

  const journalId = randomUUID();
  try {
    const backup = await readTradeJournalBackup(file);
    const journalName = await getImportedJournalName(backup.manifest.journal.name);
    const optionNames = [
      ...new Set(backup.manifest.trades.flatMap((trade) => [trade.instrument, trade.strategy])),
    ];
    const existingOptions = await prisma.tradeOption.findMany({ where: { name: { in: optionNames } } });
    const optionIds = new Map<string, string>();

    for (const trade of backup.manifest.trades) {
      for (const [type, name] of [
        ["INSTRUMENT", trade.instrument],
        ["STRATEGY", trade.strategy],
      ] as const) {
        const key = `${type}:${name}`;
        if (optionIds.has(key)) continue;
        const existing = existingOptions.find((option) => option.type === type && option.name === name);
        const option =
          existing ??
          (await prisma.tradeOption.create({
            data: { type, name },
          }));
        if (!option.active) {
          await prisma.tradeOption.update({ where: { id: option.id }, data: { active: true } });
        }
        optionIds.set(key, option.id);
      }
    }

    const trades = [];
    for (const trade of backup.manifest.trades) {
      const id = randomUUID();
      const calculated = calculateJournalTrade(trade);
      const screenshot = backup.screenshots.get(trade.screenshotFile);
      if (!screenshot) throw new Error("ZIP 备份缺少交易截图。");
      const screenshotPath = await writeScreenshotBuffer(journalId, id, path.extname(trade.screenshotFile), screenshot);

      trades.push({
        id,
        date: new Date(trade.date),
        symbol: trade.instrument,
        direction: calculated.direction,
        pnl: calculated.pnl,
        riskAmount: trade.riskAmount,
        rMultiple: calculated.rMultiple,
        instrumentOptionId: optionIds.get(`INSTRUMENT:${trade.instrument}`),
        strategyOptionId: optionIds.get(`STRATEGY:${trade.strategy}`),
        entryPrice: trade.entryPrice,
        stopLossPrice: trade.stopLossPrice,
        targetPrice: trade.targetPrice,
        exitPrice: trade.exitPrice,
        screenshotPath,
      });
    }

    const dataset = await prisma.tradeDataset.create({
      data: {
        name: `交易日志 · ${journalName}`,
        description: backup.manifest.journal.description,
        tradeJournal: {
          create: {
            id: journalId,
            name: journalName,
            description: backup.manifest.journal.description,
          },
        },
        trades: { create: trades },
      },
      include: { tradeJournal: true },
    });
    return NextResponse.json(dataset.tradeJournal, { status: 201 });
  } catch (error) {
    await removeJournalScreenshots(journalId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法导入 ZIP 备份。" }, { status: 400 });
  }
}
