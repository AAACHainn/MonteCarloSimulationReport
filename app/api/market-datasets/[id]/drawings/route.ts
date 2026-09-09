import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import {
  createMarketDrawingSchema,
  serializeMarketDrawing,
} from "@/lib/market-replay/chart-drawings";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const drawings = await prisma.marketDrawing.findMany({
    where: { datasetId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ drawings: drawings.map(serializeMarketDrawing) });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = createMarketDrawingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: copy.marketReplay.invalidDrawing }, { status: 400 });
  }
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const drawing = await prisma.marketDrawing.create({
    data: {
      datasetId: id,
      type: parsed.data.type,
      geometry: JSON.stringify(parsed.data.geometry),
      style: JSON.stringify(parsed.data.style),
    },
  });
  return NextResponse.json({ drawing: serializeMarketDrawing(drawing) }, { status: 201 });
}
