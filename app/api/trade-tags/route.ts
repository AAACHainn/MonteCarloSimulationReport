import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTagKey } from "@/lib/trade-journal/tags";
import { tradeTagSchema } from "@/lib/validations";

export async function GET() {
  return NextResponse.json(
    await prisma.tradeTag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { trades: true } } },
    }),
  );
}

export async function POST(request: Request) {
  const parsed = tradeTagSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const tag = await prisma.tradeTag.create({
      data: {
        name: parsed.data.name,
        normalizedName: normalizeTagKey(parsed.data.name),
      },
      include: { _count: { select: { trades: true } } },
    });
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "标签名称已存在。" }, { status: 400 });
    }
    throw error;
  }
}
