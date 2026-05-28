import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const run = await prisma.simulationRun.findUnique({
    where: { id },
    include: {
      dataset: {
        select: { id: true, name: true },
      },
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  }

  return NextResponse.json(run);
}
