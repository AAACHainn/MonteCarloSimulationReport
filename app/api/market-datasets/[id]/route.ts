import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import { copy } from "@/lib/i18n";
import { marketDatasetSchema } from "@/lib/validations";
import { isMarketTimestampAligned } from "@/lib/market-replay/parse-market-bars";

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

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  if (dataset.sourceIntervalSeconds !== null) return NextResponse.json({ error: copy.marketReplay.metadataLocked }, { status: 409 });
  const input = await request.json();
  const parsed = marketDatasetSchema.safeParse({ ...dataset, ...input });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const session = {
    mode: parsed.data.sessionMode, timezone: parsed.data.timezone,
    openMinute: parsed.data.sessionOpenMinute ?? null, closeMinute: parsed.data.sessionCloseMinute ?? null,
    weekdays: parsed.data.tradingWeekdays,
  } as const;
  for (let start = 0; start < dataset.barCount; start += 10_000) {
    const bars = await prisma.marketBar.findMany({ where: { datasetId: id, sequence: { gte: start, lt: start + 10_000 } }, select: { timestamp: true } });
    if (bars.some((bar) => !isMarketTimestampAligned(bar.timestamp, { sourceIntervalSeconds: parsed.data.sourceIntervalSeconds, session }))) {
      return NextResponse.json({ error: copy.marketReplay.validation.intervalMisaligned }, { status: 400 });
    }
  }
  await prisma.marketDataset.update({ where: { id }, data: {
    sourceIntervalSeconds: parsed.data.sourceIntervalSeconds, sessionMode: parsed.data.sessionMode,
    sessionOpenMinute: parsed.data.sessionOpenMinute ?? null, sessionCloseMinute: parsed.data.sessionCloseMinute ?? null,
    tradingWeekdays: parsed.data.tradingWeekdays.join(","),
  } });
  return NextResponse.json({ ok: true });
}
