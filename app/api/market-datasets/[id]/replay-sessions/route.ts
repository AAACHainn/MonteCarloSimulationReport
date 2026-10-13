import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createReplaySession, createReplaySessionSchema } from "@/lib/replay-sessions/service";
import { replayErrorResponse } from "@/lib/replay-sessions/scope";
import { listReplaySessions } from "@/lib/replay-sessions/read";
import { copy } from "@/lib/i18n";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } })) {
    return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  }
  return NextResponse.json({ sessions: await listReplaySessions(id) });
}
export async function POST(request: Request, context: Context) {
  try {
    const parsed = createReplaySessionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: copy.replaySessions.invalid }, { status: 400 });
    const session = await createReplaySession((await context.params).id, parsed.data);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) { return replayErrorResponse(error); }
}
