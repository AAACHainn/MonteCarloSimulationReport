import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { replayStartSchema } from '@/lib/validations';
import { copy } from '@/lib/i18n';
import { getReplayScope, withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { restartReplaySession } from '@/lib/replay-sessions/service';
export const POST = withReplaySessionRoute(async (request: Request) => {
  const parsed = replayStartSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: copy.replaySessions.invalid }, { status: 400 });
  const scope = getReplayScope()!;
  const current = await prisma.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
  const next = await restartReplaySession({ ...parsed.data, name: current.name, mode: scope.mode });
  return NextResponse.json({ ...next.progress, replaySessionId: next.id });
}, { write: true, allowHistoryChange: true });
