import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { paperResetSchema } from '@/lib/validations';
import { copy } from '@/lib/i18n';
import { getReplayScope, withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { archiveReplaySession, restartReplaySession } from '@/lib/replay-sessions/service';
export const POST = withReplaySessionRoute(async (request: Request) => {
  const parsed = paperResetSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: copy.replaySessions.invalid }, { status: 400 });
  if (parsed.data.action === 'CHANGE_START') {
    await prisma.$transaction((tx) => archiveReplaySession(tx));
    return NextResponse.json({ ok: true, selectNewSession: true, datasetId: getReplayScope()!.datasetId });
  }
  const next = await restartReplaySession();
  return NextResponse.json({ ok: true, replaySessionId: next.id, currentSequence: next.progress.currentSequence,
    generation: next.progress.generation, syncVersion: next.progress.syncVersion });
}, { write: true, allowHistoryChange: true });
