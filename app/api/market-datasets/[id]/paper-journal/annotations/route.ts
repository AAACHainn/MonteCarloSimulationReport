import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { accountWhere, entryProjectionWhere, journalScopeWhere } from '@/lib/replay-sessions/scope';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeReplayTradeAnnotation } from "@/lib/paper-trading/journal";
import { withReplayJournalDisplayNumbers } from "@/lib/paper-trading/journal-numbering";
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

async function handleGET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = replayTradeAnnotationsQuerySchema.safeParse({
    fromSequence: url.searchParams.get("fromSequence") ?? undefined,
    toSequence: url.searchParams.get("toSequence") ?? undefined,
    journalNo: url.searchParams.get("journalNo") ?? undefined,
    journalSessionId: url.searchParams.get("journalSessionId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });

  if (parsed.data.journalNo !== undefined) {
    const record = await prisma.replayJournalEntry.findFirst({
      where: parsed.data.journalSessionId
        ? {
            accountNo: parsed.data.journalNo,
            ...entryProjectionWhere(),
            journalSession: { id: parsed.data.journalSessionId, datasetId: id, ...journalScopeWhere() },
          }
        : { no: parsed.data.journalNo, ...entryProjectionWhere(), journalSession: { datasetId: id, ...journalScopeWhere() } },
      select: ANNOTATION_SELECT,
    });
    return NextResponse.json({
      items: (await withReplayJournalDisplayNumbers(record ? [record] : [])).map(serializeReplayTradeAnnotation),
      truncated: false,
    });
  }

  let journalSessionId = parsed.data.journalSessionId;
  if (!journalSessionId) {
    const current = await prisma.paperTradingSession.findFirst({
      where: accountWhere(id),
      select: { journalSessionId: true },
    });
    journalSessionId = current?.journalSessionId ?? undefined;
  }
  if (!journalSessionId) return NextResponse.json({ items: [], truncated: false });

  const fromSequence = parsed.data.fromSequence!;
  const toSequence = parsed.data.toSequence!;
  const historicalSessionRequested = parsed.data.journalSessionId !== undefined;
  const records = await prisma.replayJournalEntry.findMany({
    where: {
      journalSessionId,
      ...entryProjectionWhere(),
      journalSession: { datasetId: id, ...journalScopeWhere() },
      OR: [
        { openedSequence: { gte: fromSequence, lte: toSequence } },
        { closedSequence: { gte: fromSequence, lte: toSequence } },
      ],
    },
    orderBy: { no: historicalSessionRequested ? "asc" : "desc" },
    ...(historicalSessionRequested ? {} : { take: REPLAY_TRADE_ANNOTATION_LIMIT + 1 }),
    select: ANNOTATION_SELECT,
  });
  const truncated = !historicalSessionRequested && records.length > REPLAY_TRADE_ANNOTATION_LIMIT;
  const visibleRecords = historicalSessionRequested
    ? records
    : records.slice(0, REPLAY_TRADE_ANNOTATION_LIMIT).reverse();
  const items = (await withReplayJournalDisplayNumbers(visibleRecords)).map(serializeReplayTradeAnnotation);
  return NextResponse.json({ items, truncated });
}

export const GET = withReplaySessionRoute(handleGET, { write: false, annotation: false });
