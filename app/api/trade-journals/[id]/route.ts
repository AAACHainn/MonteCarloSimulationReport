import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { removeJournalScreenshots } from "@/lib/trade-journal/storage";

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
          _count: { select: { simulationRuns: true } },
        },
      },
    },
  });
  if (!journal) {
    return NextResponse.json({ error: "未找到交易日志。" }, { status: 404 });
  }
  return NextResponse.json(journal);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const journal = await prisma.tradeJournal.findUnique({ where: { id } });
  if (!journal) {
    return NextResponse.json({ error: "未找到交易日志。" }, { status: 404 });
  }

  await prisma.tradeDataset.delete({ where: { id: journal.datasetId } });
  await removeJournalScreenshots(id);
  return NextResponse.json({ ok: true });
}
