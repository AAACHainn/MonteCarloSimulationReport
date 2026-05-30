import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tradeJournalSchema } from "@/lib/validations";

export async function GET() {
  return NextResponse.json(
    await prisma.tradeJournal.findMany({
      orderBy: { createdAt: "desc" },
      include: { dataset: { include: { _count: { select: { trades: true, simulationRuns: true } } } } },
    }),
  );
}

export async function POST(request: Request) {
  const parsed = tradeJournalSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = await prisma.tradeDataset.create({
    data: {
      name: `交易日志 · ${parsed.data.name}`,
      description: parsed.data.description || null,
      tradeJournal: {
        create: {
          name: parsed.data.name,
          description: parsed.data.description || null,
        },
      },
    },
    include: { tradeJournal: true },
  });

  return NextResponse.json(dataset.tradeJournal, { status: 201 });
}
