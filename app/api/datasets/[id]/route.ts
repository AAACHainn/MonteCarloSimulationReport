import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.tradeDataset.findFirst({
    where: { id, tradeJournal: null },
    include: {
      trades: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
      _count: {
        select: { simulationRuns: true },
      },
    },
  });

  if (!dataset) {
    return NextResponse.json({ error: copy.api.datasetNotFound }, { status: 404 });
  }

  return NextResponse.json(dataset);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.tradeDataset.findFirst({ where: { id, tradeJournal: null }, select: { id: true } });
  if (!dataset) {
    return NextResponse.json({ error: copy.api.datasetNotFound }, { status: 404 });
  }

  await prisma.tradeDataset.delete({
    where: { id },
  });

  return NextResponse.json({ ok: true });
}
