import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { withReplaySessionRoute, assertReplayDrawingWritable, drawingScopeWhere } from "@/lib/replay-sessions/scope";
import { applyDrawingChanges, drawingChangesSchema } from "@/lib/market-replay/drawing-history-persistence";
import type { DrawingChange } from "@/lib/market-replay/drawing-history";
import { copy } from "@/lib/i18n";

export const POST = withReplaySessionRoute(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const parsed = drawingChangesSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
  return sqliteWriteTransaction(prisma, async tx => {
    await assertReplayDrawingWritable(tx);
    return NextResponse.json(await applyDrawingChanges(tx, id, drawingScopeWhere().replaySessionId ?? null, parsed.data.changes as DrawingChange[]));
  });
}, { write: true, drawing: true });
