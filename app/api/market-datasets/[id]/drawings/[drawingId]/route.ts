import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import {
  serializeMarketDrawing,
  updateMarketDrawingSchema,
} from "@/lib/market-replay/chart-drawings";

type RouteContext = { params: Promise<{ id: string; drawingId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id, drawingId } = await context.params;
  const parsed = updateMarketDrawingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
  }
  const existing = await prisma.marketDrawing.findFirst({ where: { id: drawingId, datasetId: id } });
  if (!existing) return NextResponse.json({ error: copy.marketReplay.drawingNotFound }, { status: 404 });
  const drawing = await prisma.marketDrawing.update({
    where: { id: drawingId },
    data: {
      ...(parsed.data.geometry ? { geometry: JSON.stringify(parsed.data.geometry) } : {}),
      ...(parsed.data.style ? { style: JSON.stringify(parsed.data.style) } : {}),
    },
  });
  return NextResponse.json({ drawing: serializeMarketDrawing(drawing) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, drawingId } = await context.params;
  const existing = await prisma.marketDrawing.findFirst({
    where: { id: drawingId, datasetId: id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: copy.marketReplay.drawingNotFound }, { status: 404 });
  await prisma.marketDrawing.delete({ where: { id: drawingId } });
  return NextResponse.json({ ok: true });
}
