import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { withReplaySessionRoute, drawingScopeWhere, assertReplayDrawingWritable, ReplaySessionError } from '@/lib/replay-sessions/scope';
import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import {
  createMarketDrawingSchema,
  serializeMarketDrawing,
} from "@/lib/market-replay/chart-drawings";
import type { MarketDrawing } from "@/lib/market-replay/chart-drawings";
import { sameDrawingSnapshot } from "@/lib/market-replay/drawing-history";

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
  const drawing = await sqliteWriteTransaction(prisma, async tx => {
    await assertReplayDrawingWritable(tx);
    const data = {
        datasetId: id,
        ...drawingScopeWhere(),
        type: parsed.data.type,
        geometry: JSON.stringify(parsed.data.geometry),
        style: JSON.stringify(parsed.data.style),
      };
    if (parsed.data.clientId) {
      // Empty update preserves the actual record on retries, including later PATCH changes.
      const record = await tx.marketDrawing.upsert({ where: { id: parsed.data.clientId },
        create: { ...data, id: parsed.data.clientId }, update: {} });
      if (record.datasetId !== id || record.replaySessionId !== data.replaySessionId || record.type !== parsed.data.type) {
        throw new ReplaySessionError("DRAWING_ID_CONFLICT", 409, copy.marketReplay.invalidDrawing);
      }
      if (request.headers.get("X-Drawing-Action") === "paste") {
        const actual = serializeMarketDrawing(record);
        if (!sameDrawingSnapshot(actual, { ...actual, geometry: parsed.data.geometry, style: parsed.data.style } as MarketDrawing)) {
          throw new ReplaySessionError("DRAWING_ID_CONFLICT", 409, copy.marketReplay.drawingEditing.conflict);
        }
      }
      return record;
    }
    return tx.marketDrawing.create({ data });
  });
  return NextResponse.json({ drawing: serializeMarketDrawing(drawing) }, { status: 201 });
}

export const GET = withReplaySessionRoute(handleGET, { write: false, annotation: false });

export const POST = withReplaySessionRoute(handlePOST, { write: true, drawing: true });

export const DELETE = withReplaySessionRoute(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const parsed = clearDrawingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
  const drawings = await sqliteWriteTransaction(prisma, async tx => {
    await assertReplayDrawingWritable(tx);
    const where = { datasetId: id, ...drawingScopeWhere() };
    const historyBefore = await tx.marketDrawing.findMany({ where: { ...where, id: { in: parsed.data.ids } } });
    await tx.marketDrawing.deleteMany({ where: { ...where, id: { in: parsed.data.ids } } });
    return { remaining: await tx.marketDrawing.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }), historyBefore };
  });
  return NextResponse.json({ drawings: drawings.remaining.map(serializeMarketDrawing), historyBefore: drawings.historyBefore.map(serializeMarketDrawing) });
}, { write: true, drawing: true });
