import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createTradeJournalBackup } from "@/lib/trade-journal/backup";

type RouteContext = { params: Promise<{ id: string }> };
const exportSelectionSchema = z.object({
  tradeIds: z.array(z.string().min(1)).min(1).max(5000),
});

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const journal = await prisma.tradeJournal.findUnique({
    where: { id },
    include: {
      dataset: {
        include: {
          trades: {
            orderBy: [{ date: "asc" }, { createdAt: "asc" }],
            include: { instrumentOption: true, strategyOption: true },
          },
        },
      },
    },
  });
  if (!journal) {
    return NextResponse.json({ error: "未找到交易日志。" }, { status: 404 });
  }

  try {
    const buffer = await createTradeJournalBackup({ ...journal, trades: journal.dataset.trades });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="trade-journal-${journal.id}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法导出交易日志。" }, { status: 400 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = exportSelectionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "请选择要导出的交易。" }, { status: 400 });
  }

  const journal = await prisma.tradeJournal.findUnique({
    where: { id },
    include: {
      dataset: true,
    },
  });
  if (!journal) {
    return NextResponse.json({ error: "未找到交易日志。" }, { status: 404 });
  }

  const order = new Map(parsed.data.tradeIds.map((tradeId, index) => [tradeId, index]));
  const trades = await prisma.trade.findMany({
    where: {
      id: { in: parsed.data.tradeIds },
      datasetId: journal.datasetId,
    },
    include: { instrumentOption: true, strategyOption: true },
  });
  trades.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  if (trades.length === 0) {
    return NextResponse.json({ error: "请选择要导出的交易。" }, { status: 400 });
  }

  try {
    const buffer = await createTradeJournalBackup({ ...journal, trades });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="trade-journal-${journal.id}-filtered.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法导出交易日志。" }, { status: 400 });
  }
}
