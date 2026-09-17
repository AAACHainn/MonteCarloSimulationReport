import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTagKey } from "@/lib/trade-journal/tags";
import { tradeTagUpdateSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = tradeTagUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const tag = await prisma.tradeTag.update({
      where: { id },
      data: {
        name: parsed.data.name,
        normalizedName: normalizeTagKey(parsed.data.name),
      },
      include: { _count: { select: { trades: true } } },
    });
    return NextResponse.json(tag);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "标签名称已存在。" }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "未找到标签。" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const tag = await prisma.tradeTag.findUnique({
    where: { id },
    include: { _count: { select: { trades: true } } },
  });
  if (!tag) {
    return NextResponse.json({ error: "未找到标签。" }, { status: 404 });
  }
  if (tag._count.trades > 0) {
    return NextResponse.json({ error: "仍有交易正在使用此标签，无法删除。" }, { status: 409 });
  }

  await prisma.tradeTag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
