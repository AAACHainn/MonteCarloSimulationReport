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
  await prisma.$transaction(async (tx) => {
    await tx.paperTradingSession.deleteMany({ where: { datasetId: id } });
    if (parsed.data.action === "CHANGE_START") await tx.replayProgress.delete({ where: { datasetId: id } });
    else await tx.replayProgress.update({ where: { datasetId: id }, data: { currentSequence: progress.startSequence - 1 } });
  });
  return NextResponse.json({ ok: true, currentSequence: parsed.data.action === "RESET" ? progress.startSequence - 1 : null });
}
