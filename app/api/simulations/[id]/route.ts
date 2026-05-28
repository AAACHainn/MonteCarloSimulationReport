import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

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
    return NextResponse.json({ error: copy.api.simulationNotFound }, { status: 404 });
  }

  return NextResponse.json(run);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.simulationRun.delete({
    where: { id },
  });

  return NextResponse.json({ ok: true });
}
