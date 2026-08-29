import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { replayProgressSchema } from "@/lib/validations";
import { copy } from "@/lib/i18n";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = replayProgressSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? copy.marketReplay.validation.progressInvalid }, { status: 400 });
  }

  const [dataset, existingProgress, paperSession] = await Promise.all([
    prisma.marketDataset.findUnique({ where: { id }, select: { barCount: true } }),
    prisma.replayProgress.findUnique({ where: { datasetId: id } }),
    prisma.paperTradingSession.findUnique({ where: { datasetId: id }, select: { id: true } }),
  ]);
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const { startSequence, currentSequence, intervalMs } = parsed.data;
  if (startSequence >= dataset.barCount || currentSequence < startSequence - 1 || currentSequence >= dataset.barCount) {
    return NextResponse.json({ error: copy.marketReplay.validation.progressOutOfRange }, { status: 400 });
  }
  if (paperSession && existingProgress && currentSequence !== existingProgress.currentSequence) {
    return NextResponse.json({ error: copy.paperTrading.conflict }, { status: 409 });
  }

  const progress = await prisma.replayProgress.upsert({
    where: { datasetId: id },
    create: { datasetId: id, startSequence, currentSequence, intervalMs },
    update: { startSequence, currentSequence, intervalMs },
  });
  return NextResponse.json({ ...progress, updatedAt: progress.updatedAt.toISOString(), createdAt: progress.createdAt.toISOString() });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.$transaction([
    prisma.paperTradingSession.deleteMany({ where: { datasetId: id } }),
    prisma.replayProgress.deleteMany({ where: { datasetId: id } }),
  ]);
  return NextResponse.json({ ok: true });
}
