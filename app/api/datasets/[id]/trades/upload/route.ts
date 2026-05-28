import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseTradesCsv } from "@/lib/csv/parse-trades";
import { copy } from "@/lib/i18n";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: copy.api.csvRequired }, { status: 400 });
  }

  const dataset = await prisma.tradeDataset.findUnique({ where: { id } });
  if (!dataset) {
    return NextResponse.json({ error: copy.api.datasetNotFound }, { status: 404 });
  }

  const csv = await file.text();
  const parsed = parseTradesCsv(csv);

  if (parsed.trades.length === 0) {
    return NextResponse.json(
      { error: copy.api.noValidTrades, rejectedRows: parsed.rejectedRows },
      { status: 400 },
    );
  }

  await prisma.$transaction([
    prisma.trade.deleteMany({ where: { datasetId: id } }),
    prisma.trade.createMany({
      data: parsed.trades.map((trade) => ({
        datasetId: id,
        date: trade.date,
        symbol: trade.symbol,
        direction: trade.direction,
        pnl: trade.pnl,
        riskAmount: trade.riskAmount,
        rMultiple: trade.rMultiple,
        note: trade.note,
      })),
    }),
  ]);

  return NextResponse.json({
    imported: parsed.trades.length,
    rejectedRows: parsed.rejectedRows,
  });
}
