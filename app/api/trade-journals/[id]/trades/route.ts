import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateJournalTrade } from "@/lib/trade-journal/calculations";
import { loadJournalTradeOptions } from "@/lib/trade-journal/options";
import { removeScreenshot, writeUploadedScreenshot } from "@/lib/trade-journal/storage";
import { parseJournalTradeFormData } from "@/lib/trade-journal/trade-input";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let screenshotPath: string | null = null;

  try {
    const journal = await prisma.tradeJournal.findUnique({ where: { id } });
    if (!journal) return NextResponse.json({ error: "未找到交易日志。" }, { status: 404 });

    const formData = await request.formData();
    const screenshot = formData.get("screenshot");
    if (!(screenshot instanceof File) || screenshot.size === 0) {
      return NextResponse.json({ error: "请上传交易截图。" }, { status: 400 });
    }

    const input = parseJournalTradeFormData(formData);
    const { instrument, strategy } = await loadJournalTradeOptions(input.instrumentOptionId, input.strategyOptionId);
    const calculated = calculateJournalTrade(input);
    const tradeId = randomUUID();
    screenshotPath = await writeUploadedScreenshot(id, instrument.name, screenshot);

    const trade = await prisma.trade.create({
      data: {
        id: tradeId,
        datasetId: journal.datasetId,
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
        screenshotPath,
      },
      include: { instrumentOption: true, strategyOption: true, tags: { orderBy: { name: "asc" } } },
    });
    return NextResponse.json(trade, { status: 201 });
  } catch (error) {
    await removeScreenshot(screenshotPath);
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法保存交易记录。" }, { status: 400 });
  }
}
