import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { replayProgressSchema } from "@/lib/validations";
import { copy } from "@/lib/i18n";
import { datasetSourceInterval } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const state = await prisma.$transaction(async (tx) => {
    let progress = await tx.replayProgress.findUnique({ where: { datasetId: id } });
    const snapshot = await getPaperSessionSnapshot(id, tx);
    // The account records which source bars were actually processed. Repair stale saves
    // produced by older clients without replaying fills or resetting the account.
    if (progress && snapshot && progress.currentSequence !== snapshot.session.lastProcessedSequence) {
      progress = await tx.replayProgress.update({
        where: { datasetId: id }, data: { currentSequence: snapshot.session.lastProcessedSequence },
      });
    }
    return { progress, snapshot };
  });
  return NextResponse.json(state);
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = replayProgressSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? copy.marketReplay.validation.progressInvalid }, { status: 400 });
  }
  const result = await prisma.$transaction(async (tx) => {
    const dataset = await tx.marketDataset.findUnique({ where: { id } });
    if (!dataset) return { error: copy.marketReplay.datasetNotFound, status: 404 } as const;
    const { startSequence, playbackRate, displayIntervalSeconds, displaySession } = parsed.data;
    const sourceSeconds = datasetSourceInterval(dataset);
    if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, displayIntervalSeconds)) {
      return { error: copy.marketReplay.invalidDisplayInterval, status: 400 } as const;
    }
    if (!resolveDisplaySession(dataset, displaySession)) {
      return { error: copy.marketReplay.unsupportedDisplaySession, status: 400 } as const;
    }
    // Advancing and resetting own the cursor. Delayed settings/pagehide requests must
    // never rewind it, even when no paper account exists.
    const updated = await tx.replayProgress.updateMany({
      where: { datasetId: id, startSequence },
      data: { playbackRate, displayIntervalSeconds, displaySession },
    });
    if (!updated.count) return { error: copy.paperTrading.conflict, status: 409 } as const;
    const progress = await tx.replayProgress.findUniqueOrThrow({ where: { datasetId: id } });
    return { progress, error: null, status: 200 } as const;
  });
  return NextResponse.json(result.error ? { error: result.error } : result.progress, { status: result.status });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.$transaction([
    prisma.paperTradingSession.deleteMany({ where: { datasetId: id } }),
    prisma.replayProgress.deleteMany({ where: { datasetId: id } }),
  ]);
  return NextResponse.json({ ok: true });
}
