import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildTradeDuplicateKey, readTradeJournalBackup } from "@/lib/trade-journal/backup";
import { calculateJournalTrade } from "@/lib/trade-journal/calculations";
import { removeScreenshot, writeScreenshotBuffer } from "@/lib/trade-journal/storage";
import { resolveTradeTags } from "@/lib/trade-journal/tag-service";
import { deduplicateTagNames, normalizeTagKey } from "@/lib/trade-journal/tags";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 ZIP 备份。" }, { status: 400 });
  }

  const writtenScreenshots: string[] = [];

  try {
    const journal = await prisma.tradeJournal.findUnique({
      where: { id },
      include: {
        dataset: {
          include: {
            trades: {
              include: { instrumentOption: true },
            },
          },
        },
      },
    });
    if (!journal) {
      return NextResponse.json({ error: "未找到交易日志。" }, { status: 404 });
    }

    const backup = await readTradeJournalBackup(file);
    const duplicateKeys = new Set(
      journal.dataset.trades
        .map((trade) =>
          buildTradeDuplicateKey({
            date: trade.date,
            instrument: trade.instrumentOption?.name ?? trade.symbol,
            entryPrice: trade.entryPrice,
            stopLossPrice: trade.stopLossPrice,
            targetPrice: trade.targetPrice,
          }),
        )
        .filter((key): key is string => Boolean(key)),
    );
    let skippedDuplicateCount = 0;
    const importableTrades = [];

    for (const trade of backup.manifest.trades) {
      const duplicateKey = buildTradeDuplicateKey({
        date: trade.date,
        instrument: trade.instrument,
        entryPrice: trade.entryPrice,
        stopLossPrice: trade.stopLossPrice,
        targetPrice: trade.targetPrice,
      });
      if (duplicateKey && duplicateKeys.has(duplicateKey)) {
        skippedDuplicateCount += 1;
        continue;
      }
      if (duplicateKey) duplicateKeys.add(duplicateKey);
      importableTrades.push(trade);
    }

    const optionIds = new Map<string, string>();

    for (const trade of importableTrades) {
      for (const [type, name] of [
        ["INSTRUMENT", trade.instrument],
        ["STRATEGY", trade.strategy],
      ] as const) {
        const key = `${type}:${name}`;
        if (optionIds.has(key)) continue;

        const option = await prisma.tradeOption.upsert({
          where: { type_name: { type, name } },
          update: { active: true },
          create: { type, name },
        });
        optionIds.set(key, option.id);
      }
    }

    const trades = [];
    const resolvedTags = await resolveTradeTags(
      prisma,
      deduplicateTagNames(importableTrades.flatMap((trade) => trade.tags)),
    );
    const tagIds = new Map(resolvedTags.map((tag) => [normalizeTagKey(tag.name), tag.id]));

    for (const trade of importableTrades) {
      const screenshot = backup.screenshots.get(trade.screenshotFile);
      if (!screenshot) throw new Error("ZIP 备份缺少交易截图。");

      const calculated = calculateJournalTrade(trade);
      const screenshotPath = await writeScreenshotBuffer(id, trade.instrument, path.extname(trade.screenshotFile), screenshot);
      writtenScreenshots.push(screenshotPath);

      trades.push({
        id: randomUUID(),
        datasetId: journal.datasetId,
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
        strategyCode: trade.strategyCode,
        screenshotPath,
        tags: {
          connect: trade.tags.map((name) => ({ id: tagIds.get(normalizeTagKey(name))! })),
        },
      });
    }

    if (trades.length > 0) {
      await prisma.$transaction(trades.map((data) => prisma.trade.create({ data })));
    }

    return NextResponse.json({
      importedCount: trades.length,
      skippedDuplicateCount,
    });
  } catch (error) {
    await Promise.all(writtenScreenshots.map((screenshotPath) => removeScreenshot(screenshotPath)));
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法合并 ZIP 备份。" }, { status: 400 });
  }
}
