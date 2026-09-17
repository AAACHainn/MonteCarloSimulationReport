import { NextResponse } from "next/server";
import { prisma, replayDatabaseQueryCount } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { chunkRequestBounds, tradingDayBounds, tradingDayForTimestamp } from "@/lib/market-replay/chunks";
import { datasetSession, datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import { replayChunksSchema } from "@/lib/validations";
import { attachReplayDiagnostics } from "@/lib/market-replay/server-diagnostics";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const startedAt = performance.now();
  const queryStart = replayDatabaseQueryCount();
  const { id } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const parsed = replayChunksSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const dataset = await prisma.marketDataset.findUnique({ where: { id } });
  if (!dataset || dataset.status !== "READY") {
    return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  }
  if (dataset.dataVersion !== parsed.data.version) {
    return NextResponse.json({ error: copy.marketReplay.cacheVersionConflict, dataVersion: dataset.dataVersion }, { status: 409 });
  }
  const sourceIntervalSeconds = datasetSourceInterval(dataset);
  if (!sourceIntervalSeconds) {
    return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
  }

  const session = datasetSession(dataset);
  let range;
  try {
    range = chunkRequestBounds(parsed.data.startDate, sourceIntervalSeconds, session);
  } catch {
    return NextResponse.json({ error: copy.marketReplay.validation.progressInvalid }, { status: 400 });
  }
  const records = await prisma.marketBar.findMany({
    where: { datasetId: id, timestamp: { gte: new Date(range.start), lt: new Date(range.end) } },
    orderBy: { sequence: "asc" },
  });
  const grouped = new Map(range.dates.map((date) => [date, [] as ReturnType<typeof serializeSourceBar>[]]));
  for (const record of records) {
    const day = tradingDayForTimestamp(record.timestamp, session);
    grouped.get(day)?.push(serializeSourceBar(record));
  }
  const requested = new Set((searchParams.get("dates") ?? "").split(",").filter((date) => range.dates.includes(date)));
  const responseDates = requested.size ? range.dates.filter((date) => requested.has(date)) : range.dates;
  const chunks = responseDates.map((tradingDay) => {
    const bounds = tradingDayBounds(tradingDay, session);
    return {
      tradingDay,
      rangeStart: new Date(bounds.start).toISOString(),
      rangeEnd: new Date(bounds.end).toISOString(),
      bars: grouped.get(tradingDay) ?? [],
    };
  });
  const next = await prisma.marketBar.findFirst({
    where: { datasetId: id, timestamp: { gte: new Date(range.end) } },
    orderBy: { sequence: "asc" },
    select: { timestamp: true },
  });

  const response = NextResponse.json({
    datasetId: id,
    dataVersion: dataset.dataVersion,
    symbol: dataset.symbol,
    sourceIntervalSeconds,
    requestStartDate: range.dates[0],
    requestEndDate: range.dates.at(-1),
    coveredDates: range.dates,
    chunks,
    nextStartDate: next ? tradingDayForTimestamp(next.timestamp, session) : null,
  });
  return attachReplayDiagnostics(response, {
    startedAt,
    queryStart,
    strategy: "source-day-chunks",
  });
}
