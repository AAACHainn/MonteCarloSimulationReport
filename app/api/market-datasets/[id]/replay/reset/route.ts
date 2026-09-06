import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { paperResetSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperResetSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: copy.marketReplay.validation.progressInvalid }, { status: 400 });
  const progress = await prisma.replayProgress.findUnique({ where: { datasetId: id } });
  if (!progress) return NextResponse.json({ error: copy.marketReplay.validation.progressInvalid }, { status: 404 });
  const resetProgress = await prisma.$transaction(async (tx) => {
    await tx.paperTradingSession.deleteMany({ where: { datasetId: id } });
    const currentDataset = await tx.marketDataset.findUniqueOrThrow({
      where: { id },
      select: { replayGeneration: true },
    });
    const dataset = await tx.marketDataset.update({
      where: { id },
      data: { replayGeneration: Math.max(currentDataset.replayGeneration, progress.generation) + 1 },
      select: { replayGeneration: true },
    });
    if (parsed.data.action === "CHANGE_START") {
      await tx.replayProgress.delete({ where: { datasetId: id } });
      return null;
    } else {
      return tx.replayProgress.update({
        where: { datasetId: id },
        data: {
          currentSequence: progress.startSequence - 1,
          generation: dataset.replayGeneration,
          syncVersion: 0,
          lastSyncRequestId: null,
          lastSyncResponse: null,
        },
      });
    }
  });
  return NextResponse.json({
    ok: true,
    currentSequence: resetProgress?.currentSequence ?? null,
    generation: resetProgress?.generation ?? null,
    syncVersion: resetProgress?.syncVersion ?? null,
  });
}
