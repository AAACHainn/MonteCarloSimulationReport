import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { normalizeTradeReasonKey } from "@/lib/paper-trading/trade-reasons";
import { tradeReasonUpdateSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = tradeReasonUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const reason = await prisma.tradeReason.update({
      where: { id },
      data: {
        name: parsed.data.name,
        normalizedName: normalizeTradeReasonKey(parsed.data.name),
      },
      include: { _count: { select: { replayJournalEntries: true } } },
    });
    return NextResponse.json(reason);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: copy.api.tradeReasonNameExists }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: copy.api.tradeReasonNotFound }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const reason = await prisma.tradeReason.findUnique({
    where: { id },
    include: { _count: { select: { replayJournalEntries: true } } },
  });
  if (!reason) {
    return NextResponse.json({ error: copy.api.tradeReasonNotFound }, { status: 404 });
  }
  if (reason._count.replayJournalEntries > 0) {
    return NextResponse.json({ error: copy.api.tradeReasonInUse }, { status: 409 });
  }

  await prisma.tradeReason.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
