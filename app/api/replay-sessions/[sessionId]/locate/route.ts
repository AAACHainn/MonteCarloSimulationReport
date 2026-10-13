import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadReplayScope, replayErrorResponse, ReplaySessionError } from "@/lib/replay-sessions/scope";
import { copy } from "@/lib/i18n";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await loadReplayScope((await context.params).sessionId);
    const progress = await prisma.replayProgress.findUnique({ where: { replaySessionId: scope.id } });
    if (!progress) throw new ReplaySessionError("SESSION_NOT_FOUND", 404, copy.replaySessions.missing);
    const minSequence = progress.startSequence - 1;
    const params = new URL(request.url).searchParams;
    const forward = params.get("direction") === "FORWARD";
    if (forward && scope.mode !== "LIVE_REPLAY") throw new ReplaySessionError("MODE_NOT_ALLOWED", 403, copy.replaySessions.modeBlocked);
    const market = await prisma.marketDataset.findUniqueOrThrow({ where: { id: scope.datasetId }, select: { startTime: true, barCount: true } });
    const maxSequence = forward ? market.barCount - 1 : progress.currentSequence;
    const sequence = params.has("sequence") ? Number(params.get("sequence")) : null;
    const timestamp = params.has("timestamp") ? new Date(params.get("timestamp")!) : null;
    const valid = sequence !== null ? Number.isInteger(sequence) && sequence >= minSequence && sequence <= maxSequence : timestamp && Number.isFinite(timestamp.getTime());
    if (!valid) throw new ReplaySessionError("INVALID_TARGET", 400, copy.replaySessions.correctionInvalid);
    const [bar, minimum, maximum, dataset] = await Promise.all([
      sequence === -1 ? null : prisma.marketBar.findFirst({ where: {
        datasetId: scope.datasetId, sequence: sequence === null ? { gte: Math.max(0, forward ? progress.currentSequence : minSequence), lte: maxSequence } : sequence,
        ...(timestamp ? { timestamp: forward ? { gte: timestamp } : { lte: timestamp } } : {}),
      }, orderBy: { sequence: forward ? "asc" : "desc" }, select: { sequence: true, timestamp: true } }),
      prisma.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: Math.max(0, minSequence) } }, select: { timestamp: true } }),
      maxSequence >= 0 ? prisma.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: maxSequence } }, select: { timestamp: true } }) : null,
      prisma.marketDataset.findUniqueOrThrow({ where: { id: scope.datasetId }, select: { startTime: true } }),
    ]);
    if (!bar && sequence !== -1) throw new ReplaySessionError("INVALID_TARGET", 400, copy.replaySessions.correctionInvalid);
    return NextResponse.json({ sequence: bar?.sequence ?? -1, timestamp: (bar?.timestamp ?? dataset.startTime).toISOString(), minSequence, maxSequence,
      minTimestamp: (minimum?.timestamp ?? dataset.startTime).toISOString(), maxTimestamp: (maximum?.timestamp ?? dataset.startTime).toISOString() });
  } catch (error) { return replayErrorResponse(error); }
}
