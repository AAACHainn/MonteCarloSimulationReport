import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { datasetSchema } from "@/lib/validations";

export async function GET() {
  const datasets = await prisma.tradeDataset.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { trades: true, simulationRuns: true },
      },
    },
  });

  return NextResponse.json(datasets);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = datasetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = await prisma.tradeDataset.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
    },
  });

  return NextResponse.json(dataset, { status: 201 });
}
