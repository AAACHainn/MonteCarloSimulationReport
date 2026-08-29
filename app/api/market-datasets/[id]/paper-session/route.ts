import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { paperSessionSchema } from "@/lib/validations";

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
  const progress = await prisma.replayProgress.findUnique({ where: { datasetId: id } });
  if (!progress) return NextResponse.json({ error: copy.marketReplay.validation.progressInvalid }, { status: 400 });
  try {
    await prisma.paperTradingSession.create({
      data: {
        datasetId: id,
        ...parsed.data,
        lastProcessedSequence: progress.currentSequence,
        peakEquity: parsed.data.initialCapital,
      },
    });
  } catch {
    return NextResponse.json({ error: copy.paperTrading.requestFailed }, { status: 409 });
  }
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) }, { status: 201 });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.paperTradingSession.deleteMany({ where: { datasetId: id } });
  return NextResponse.json({ ok: true });
}
