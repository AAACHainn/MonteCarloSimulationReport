import { withSqliteErrors, sqliteErrorResponse } from "@/lib/sqlite-write-response";
import { retrySqliteWrite } from "@/lib/sqlite-write";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateJournalTrade } from "@/lib/trade-journal/calculations";
import { loadJournalTradeOptions } from "@/lib/trade-journal/options";
import { removeScreenshot, writeUploadedScreenshot } from "@/lib/trade-journal/storage";
import { parseJournalTradeFormData } from "@/lib/trade-journal/trade-input";

type RouteContext = { params: Promise<{ id: string; tradeId: string }> };

async function getTrade(id: string, tradeId: string) {
  return prisma.trade.findFirst({
    where: { id: tradeId, dataset: { tradeJournal: { id } } },
  });
}

async function handlePUT(request: Request, context: RouteContext) {
  const { id, tradeId } = await context.params;
  let newScreenshotPath: string | null = null;

  try {
    const trade = await getTrade(id, tradeId);
    if (!trade) return NextResponse.json({ error: "未找到交易记录。" }, { status: 404 });

    const formData = await request.formData();
    const input = parseJournalTradeFormData(formData);
    const { instrument, strategy } = await loadJournalTradeOptions(
      input.instrumentOptionId,
      input.strategyOptionId,
      [trade.instrumentOptionId, trade.strategyOptionId].filter((value): value is string => Boolean(value)),
    );
    const calculated = calculateJournalTrade(input);
    const screenshot = formData.get("screenshot");
    if (screenshot instanceof File && screenshot.size > 0) {
      newScreenshotPath = await writeUploadedScreenshot(id, instrument.name, screenshot);
    }

    const updated = await retrySqliteWrite(() => prisma.trade.update({
      where: { id: tradeId },
      data: {
        date: input.date,
        symbol: instrument.name,
        direction: calculated.direction,
        pnl: calculated.pnl,
        riskAmount: input.riskAmount,
        rMultiple: calculated.rMultiple,
        instrumentOptionId: instrument.id,
        strategyOptionId: strategy.id,
        entryPrice: input.entryPrice,
        stopLossPrice: input.stopLossPrice,
        targetPrice: input.targetPrice,
        exitPrice: input.exitPrice,
        strategyCode: input.strategyCode,
        screenshotPath: newScreenshotPath ?? trade.screenshotPath,
      },
      include: { instrumentOption: true, strategyOption: true, tags: { orderBy: { name: "asc" } } },
    }));

    if (newScreenshotPath) await removeScreenshot(trade.screenshotPath);
    return NextResponse.json(updated);
  } catch (error) {
    await removeScreenshot(newScreenshotPath);
    const busy = sqliteErrorResponse(error); if (busy) return busy;
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法更新交易记录。" }, { status: 400 });
  }
}

async function handleDELETE(_request: Request, context: RouteContext) {
  const { id, tradeId } = await context.params;
  const trade = await getTrade(id, tradeId);
  if (!trade) return NextResponse.json({ error: "未找到交易记录。" }, { status: 404 });

  await retrySqliteWrite(() => prisma.trade.delete({ where: { id: tradeId } }));
  await removeScreenshot(trade.screenshotPath);
  return NextResponse.json({ ok: true });
}

export const PUT = withSqliteErrors(handlePUT);

export const DELETE = withSqliteErrors(handleDELETE);
