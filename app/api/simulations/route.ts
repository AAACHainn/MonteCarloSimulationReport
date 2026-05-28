import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { simulateMonteCarlo } from "@/lib/monte-carlo/simulate";
import type { SimulationConfig } from "@/lib/monte-carlo/types";
import { simulationConfigSchema } from "@/lib/validations";

export async function GET() {
  const runs = await prisma.simulationRun.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      dataset: {
        select: { id: true, name: true },
      },
    },
  });

  return NextResponse.json(runs);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = simulationConfigSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { datasetId, ...config } = parsed.data;
  const trades = await prisma.trade.findMany({
    where: { datasetId },
    select: { rMultiple: true },
  });

  if (trades.length === 0) {
    return NextResponse.json({ error: "Dataset must contain at least one valid trade." }, { status: 400 });
  }

  const simulationConfig: SimulationConfig = config;
  const result = simulateMonteCarlo(simulationConfig, trades);

  const run = await prisma.simulationRun.create({
    data: {
      datasetId,
      config: JSON.stringify(result.config),
      summary: JSON.stringify(result.summary),
      samplePaths: JSON.stringify(result.samplePaths),
      percentileCurves: JSON.stringify(result.percentileCurves),
    },
  });

  return NextResponse.json({ id: run.id }, { status: 201 });
}
