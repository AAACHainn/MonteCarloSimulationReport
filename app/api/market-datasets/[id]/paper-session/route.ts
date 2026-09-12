import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { paperSessionSchema } from "@/lib/validations";
import { archiveAndDeletePaperSession } from "@/lib/paper-trading/journal-storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperSessionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  let created = false;
  try {
    created = await prisma.$transaction(async (tx) => {
      const [progress, dataset] = await Promise.all([
        tx.replayProgress.findUnique({ where: { datasetId: id }, select: { currentSequence: true, generation: true } }),
        tx.marketDataset.findUnique({ where: { id }, select: { barCount: true } }),
      ]);
      if (!progress || !dataset) return false;
      const journal = await tx.replayJournalSession.create({
        data: { datasetId: id, replayGeneration: progress.generation, ...parsed.data },
      });
      await tx.paperTradingSession.create({
        data: {
          datasetId: id,
          journalSessionId: journal.id,
          ...parsed.data,
          lastProcessedSequence: progress.currentSequence,
          peakEquity: parsed.data.initialCapital,
          equitySampleStride: Math.max(1, Math.ceil(dataset.barCount / 20_000)),
        },
      });
      return true;
    });
  } catch {
    return NextResponse.json({ error: copy.paperTrading.requestFailed }, { status: 409 });
  }
  if (!created) return NextResponse.json({ error: copy.marketReplay.validation.progressInvalid }, { status: 400 });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) }, { status: 201 });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.$transaction((tx) => archiveAndDeletePaperSession(tx, id));
  return NextResponse.json({ ok: true });
}
