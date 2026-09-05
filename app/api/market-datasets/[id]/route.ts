import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import { copy } from "@/lib/i18n";
import { marketDatasetSchema, priceTickSizeSchema } from "@/lib/validations";
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
  const input = await request.json();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: copy.marketReplay.validation.metadataInvalid }, { status: 400 });
  }
  const inputKeys = Object.keys(input);
  if (dataset.sourceIntervalSeconds !== null) {
    if (inputKeys.length !== 1 || inputKeys[0] !== "priceTickSize") {
      return NextResponse.json({ error: copy.marketReplay.metadataLocked }, { status: 409 });
    }
    const priceTickSize = priceTickSizeSchema.safeParse(input.priceTickSize);
    if (!priceTickSize.success) return NextResponse.json({ error: priceTickSize.error.issues[0]?.message }, { status: 400 });
    await prisma.marketDataset.update({ where: { id }, data: { priceTickSize: priceTickSize.data } });
    return NextResponse.json({ ok: true, priceTickSize: priceTickSize.data });
  }
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
    priceTickSize: parsed.data.priceTickSize,
    sessionOpenMinute: parsed.data.sessionOpenMinute ?? null, sessionCloseMinute: parsed.data.sessionCloseMinute ?? null,
    tradingWeekdays: parsed.data.tradingWeekdays.join(","),
  } });
  return NextResponse.json({ ok: true });
}
