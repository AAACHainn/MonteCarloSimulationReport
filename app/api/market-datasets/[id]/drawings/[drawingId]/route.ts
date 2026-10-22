import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { withReplaySessionRoute, drawingScopeWhere, assertReplayDrawingWritable } from '@/lib/replay-sessions/scope';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import {
  drawingStyleMatchesType,
  drawingGeometryMatchesType,
  DRAWING_TYPES,
  type DrawingType,
  serializeMarketDrawing,
  updateMarketDrawingSchema,
} from "@/lib/market-replay/chart-drawings";

type RouteContext = { params: Promise<{ id: string; drawingId: string }> };

async function handlePATCH(request: Request, context: RouteContext) {
  const { id, drawingId } = await context.params;
  const parsed = updateMarketDrawingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
  }
  return sqliteWriteTransaction(prisma, async tx => {
    await assertReplayDrawingWritable(tx);
    const existing = await tx.marketDrawing.findFirst({ where: { id: drawingId, datasetId: id, ...drawingScopeWhere() } });
    if (!existing) return NextResponse.json({ error: copy.marketReplay.drawingNotFound }, { status: 404 });
    if (parsed.data.style && (
      !DRAWING_TYPES.includes(existing.type as DrawingType)
      || !drawingStyleMatchesType(existing.type as DrawingType, parsed.data.style)
    )) {
      return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
    }
    if (parsed.data.geometry && !drawingGeometryMatchesType(existing.type, parsed.data.geometry)) {
      return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
    }
    const drawing = await tx.marketDrawing.update({
      where: { id: drawingId },
      data: {
        ...(parsed.data.geometry ? { geometry: JSON.stringify(parsed.data.geometry) } : {}),
        ...(parsed.data.style ? { style: JSON.stringify(parsed.data.style) } : {}),
      },
    });
    return NextResponse.json({ drawing: serializeMarketDrawing(drawing) });
  });
}

async function handleDELETE(_request: Request, context: RouteContext) {
  const { id, drawingId } = await context.params;
  return sqliteWriteTransaction(prisma, async tx => {
    await assertReplayDrawingWritable(tx);
    const existing = await tx.marketDrawing.findFirst({
      where: { id: drawingId, datasetId: id, ...drawingScopeWhere() },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: copy.marketReplay.drawingNotFound }, { status: 404 });
    await tx.marketDrawing.delete({ where: { id: drawingId } });
    return NextResponse.json({ ok: true });
  });
}

export const PATCH = withReplaySessionRoute(handlePATCH, { write: true, drawing: true });

export const DELETE = withReplaySessionRoute(handleDELETE, { write: true, drawing: true });
