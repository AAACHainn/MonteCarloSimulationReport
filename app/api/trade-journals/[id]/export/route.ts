import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createTradeJournalBackup } from "@/lib/trade-journal/backup";

type RouteContext = { params: Promise<{ id: string }> };

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
