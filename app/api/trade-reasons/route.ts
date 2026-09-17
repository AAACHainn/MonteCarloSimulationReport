import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { normalizeTradeReasonKey } from "@/lib/paper-trading/trade-reasons";
import { tradeReasonSchema } from "@/lib/validations";

export async function GET() {
  return NextResponse.json(
    await prisma.tradeReason.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { replayJournalEntries: true } } },
    }),
  );
}

export async function POST(request: Request) {
  const parsed = tradeReasonSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const reason = await prisma.tradeReason.create({
      data: {
        name: parsed.data.name,
        normalizedName: normalizeTradeReasonKey(parsed.data.name),
      },
      include: { _count: { select: { replayJournalEntries: true } } },
    });
    return NextResponse.json(reason, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: copy.api.tradeReasonNameExists }, { status: 400 });
    }
    throw error;
  }
}
