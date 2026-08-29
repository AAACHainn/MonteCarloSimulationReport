import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const bars = await prisma.marketBar.findMany({
    where: { datasetId: id },
    orderBy: { sequence: "asc" },
    select: { sequence: true, timestamp: true, open: true, high: true, low: true, close: true, volume: true },
  });
  return NextResponse.json({ bars: bars.map((bar) => ({ ...bar, timestamp: bar.timestamp.toISOString() })) });
}
