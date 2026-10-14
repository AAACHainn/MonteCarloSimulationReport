import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { loadReplayScope, runWithReplayScope, replayErrorResponse } from "@/lib/replay-sessions/scope";
import { archiveReplaySession, deleteReplaySession, deleteReplaySessionSchema, renameReplaySession, updateSessionPreferences } from "@/lib/replay-sessions/service";
import { listReplaySessions } from "@/lib/replay-sessions/read";
import { copy } from "@/lib/i18n";

type Context = { params: Promise<{ sessionId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const scope = await loadReplayScope((await context.params).sessionId);
    return await runWithReplayScope(scope, async () => {
      const sessions = await listReplaySessions(scope.datasetId);
      return NextResponse.json({ session: sessions.find((s) => s.id === scope.id), snapshot: await getPaperSessionSnapshot(scope.datasetId) });
    });
  } catch (error) { return replayErrorResponse(error); }
}
const patchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(100).optional(),
  status: z.literal("ARCHIVED").optional(),
  riskPreferences: z.object({ riskAmount: z.number().finite().positive().optional(), targetR: z.number().finite().positive().optional() }).optional(),
}).strict().refine((value) => Number(value.name !== undefined) + Number(value.status !== undefined) + Number(value.riskPreferences !== undefined) === 1);
export async function PATCH(request: Request, context: Context) {
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: copy.replaySessions.invalid }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    if (scope.version !== parsed.data.expectedVersion) return NextResponse.json({ error: copy.replaySessions.conflict, code: "SESSION_CONFLICT" }, { status: 409 });
    await runWithReplayScope(scope, async () => {
      if (parsed.data.riskPreferences) return updateSessionPreferences(scope.id, parsed.data.expectedVersion, JSON.stringify(parsed.data.riskPreferences));
      await prisma.$transaction(async (tx) => {
        if (parsed.data.status) return archiveReplaySession(tx);
        await renameReplaySession(tx, parsed.data.name!);
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return replayErrorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const parsed = deleteReplaySessionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: copy.replaySessions.deleteInvalid }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    await runWithReplayScope(scope, () => prisma.$transaction((tx) => deleteReplaySession(tx, parsed.data.expectedVersion)));
    return NextResponse.json({ ok: true });
  } catch (error) { return replayErrorResponse(error); }
}
