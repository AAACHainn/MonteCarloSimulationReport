import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import { copy } from "@/lib/i18n";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, include: { progress: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  return NextResponse.json(serializeMarketDataset(dataset));
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  await prisma.marketDataset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
