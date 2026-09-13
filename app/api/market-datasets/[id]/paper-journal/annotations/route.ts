import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeReplayTradeAnnotation } from "@/lib/paper-trading/journal";
import { REPLAY_TRADE_ANNOTATION_LIMIT } from "@/lib/paper-trading/trade-annotations";
import { replayTradeAnnotationsQuerySchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

const ANNOTATION_SELECT = {
  id: true,
  no: true,
  accountNo: true,
  direction: true,
  entryOrderType: true,
  openedSequence: true,
  closedSequence: true,
  entryPrice: true,
  initialStopPrice: true,
  actualRisk: true,
  exitPrice: true,
  gainLoss: true,
  priceTickSize: true,
} as const;

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = replayTradeAnnotationsQuerySchema.safeParse({
    fromSequence: url.searchParams.get("fromSequence") ?? undefined,
    toSequence: url.searchParams.get("toSequence") ?? undefined,
    journalNo: url.searchParams.get("journalNo") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });

  if (parsed.data.journalNo !== undefined) {
    const record = await prisma.replayJournalEntry.findFirst({
      where: { no: parsed.data.journalNo, journalSession: { datasetId: id } },
      select: ANNOTATION_SELECT,
    });
    return NextResponse.json({
      items: record ? [serializeReplayTradeAnnotation(record)] : [],
      truncated: false,
    });
  }

  const current = await prisma.paperTradingSession.findUnique({
    where: { datasetId: id },
    select: { journalSessionId: true },
  });
  if (!current?.journalSessionId) return NextResponse.json({ items: [], truncated: false });

  const fromSequence = parsed.data.fromSequence!;
  const toSequence = parsed.data.toSequence!;
  const records = await prisma.replayJournalEntry.findMany({
    where: {
      journalSessionId: current.journalSessionId,
      OR: [
        { openedSequence: { gte: fromSequence, lte: toSequence } },
        { closedSequence: { gte: fromSequence, lte: toSequence } },
      ],
    },
    orderBy: { no: "desc" },
    take: REPLAY_TRADE_ANNOTATION_LIMIT + 1,
    select: ANNOTATION_SELECT,
  });
  const truncated = records.length > REPLAY_TRADE_ANNOTATION_LIMIT;
  const items = records
    .slice(0, REPLAY_TRADE_ANNOTATION_LIMIT)
    .reverse()
    .map(serializeReplayTradeAnnotation);
  return NextResponse.json({ items, truncated });
}
