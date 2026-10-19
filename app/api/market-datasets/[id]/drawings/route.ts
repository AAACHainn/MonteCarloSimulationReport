import { withReplaySessionRoute, drawingScopeWhere, assertReplayDrawingWritable } from '@/lib/replay-sessions/scope';
import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import {
  createMarketDrawingSchema,
  serializeMarketDrawing,
} from "@/lib/market-replay/chart-drawings";

type RouteContext = { params: Promise<{ id: string }> };
const clearDrawingsSchema = z.object({ ids: z.array(z.string().min(1).max(200)).max(20_000) }).strict();

async function handleGET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const drawings = await prisma.marketDrawing.findMany({
    where: { datasetId: id, ...drawingScopeWhere() },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ drawings: drawings.map(serializeMarketDrawing) });
}

async function handlePOST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = createMarketDrawingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
  }
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const drawing = await prisma.$transaction(async tx => {
    await assertReplayDrawingWritable(tx);
    return tx.marketDrawing.create({
      data: {
        datasetId: id,
        ...drawingScopeWhere(),
        type: parsed.data.type,
        geometry: JSON.stringify(parsed.data.geometry),
        style: JSON.stringify(parsed.data.style),
      },
    });
  });
  return NextResponse.json({ drawing: serializeMarketDrawing(drawing) }, { status: 201 });
}

export const GET = withReplaySessionRoute(handleGET, { write: false, annotation: false });

export const POST = withReplaySessionRoute(handlePOST, { write: true, drawing: true });

export const DELETE = withReplaySessionRoute(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const parsed = clearDrawingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
  const drawings = await prisma.$transaction(async tx => {
    await assertReplayDrawingWritable(tx);
    const where = { datasetId: id, ...drawingScopeWhere() };
    await tx.marketDrawing.deleteMany({ where: { ...where, id: { in: parsed.data.ids } } });
    return tx.marketDrawing.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  });
  return NextResponse.json({ drawings: drawings.map(serializeMarketDrawing) });
}, { write: true, drawing: true });
