import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadReplayScope, replayErrorResponse, ReplaySessionError } from "@/lib/replay-sessions/scope";
import { copy } from "@/lib/i18n";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await loadReplayScope((await context.params).sessionId);
    const cycleKey = new URL(request.url).searchParams.get("cycleKey");
    const account = await prisma.paperTradingSession.findUnique({ where: { projectionId: scope.projectionId } });
    if (!cycleKey || !account) throw new ReplaySessionError("CYCLE_NOT_FOUND", 404, copy.replaySessions.correctionInvalid);
    const [closed, bounds, entryCount] = await Promise.all([
      prisma.paperFill.findFirst({ where: { sessionId: account.id, cycleKey, netQuantityAfter: 0 }, select: { id: true } }),
      prisma.paperOrder.aggregate({ where: { sessionId: account.id, isProtective: false, fills: { some: { cycleKey } } }, _min: { createdSequence: true } }),
      prisma.replayJournalEntry.count({ where: { projectionId: scope.projectionId, cycleKey } }),
    ]);
    if (bounds._min.createdSequence === null) throw new ReplaySessionError("CYCLE_NOT_FOUND", 404, copy.replaySessions.correctionInvalid);
    return NextResponse.json({ closed: Boolean(closed), entryCount, fallbackTargetSequence: bounds._min.createdSequence });
  } catch (error) { return replayErrorResponse(error); }
}
