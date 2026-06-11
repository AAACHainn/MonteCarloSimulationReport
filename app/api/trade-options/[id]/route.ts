import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tradeOptionUpdateSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = tradeOptionUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const option = await prisma.tradeOption.update({ where: { id }, data: parsed.data });
    return NextResponse.json(option);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "同类型选项名称已存在。" }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const option = await prisma.tradeOption.findUnique({
    where: { id },
    include: { _count: { select: { instrumentTrades: true, strategyTrades: true } } },
  });
  if (!option) {
    return NextResponse.json({ error: "未找到选项。" }, { status: 404 });
  }

  const referenceCount = option._count.instrumentTrades + option._count.strategyTrades;
  if (referenceCount > 0) {
    await prisma.tradeOption.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }

  await prisma.tradeOption.delete({ where: { id } });
  return NextResponse.json({ ok: true, deactivated: false });
}
