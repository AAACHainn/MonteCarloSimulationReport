import { parseChecklist } from "@/lib/paper-trading/training-gate";
import { copy } from "@/lib/i18n";
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
    const option = await prisma.$transaction(async (tx) => {
      const existing = await tx.tradeOption.findUnique({ where: { id } });
      if (!existing) return null;
      const { checklist, checklistVersion, ...fields } = parsed.data;
      if (checklist && (existing.type !== "STRATEGY" || checklistVersion !== existing.checklistVersion)) return false;
      return tx.tradeOption.update({ where: { id }, data: { ...fields, ...(checklist ? { checklist: JSON.stringify(checklist), checklistVersion: { increment: 1 } } : {}) } });
    });
    if (option === null) return NextResponse.json({ error: copy.trainingGate.invalidStrategy }, { status: 404 });
    if (option === false) return NextResponse.json({ error: copy.trainingGate.checklistChanged }, { status: 409 });
    return NextResponse.json({ ...option, checklist: parseChecklist(option.checklist) });
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
    include: {
      _count: {
        select: { instrumentTrades: true, strategyTrades: true, replayJournalSetups: true },
      },
    },
  });
  if (!option) {
    return NextResponse.json({ error: "未找到选项。" }, { status: 404 });
  }

  const referenceCount = option._count.instrumentTrades
    + option._count.strategyTrades
    + option._count.replayJournalSetups;
  const [snapshotReference] = referenceCount === 0 ? await prisma.$queryRaw<Array<{ found: number }>>`
    SELECT 1 AS found FROM PaperOrder WHERE json_extract(discipline, '$.strategyId') = ${id}
    UNION ALL SELECT 1 FROM PaperPositionLot WHERE json_extract(discipline, '$.strategyId') = ${id}
    UNION ALL SELECT 1 FROM ReplayJournalEntry WHERE json_extract(discipline, '$.strategyId') = ${id} LIMIT 1` : [];
  if (referenceCount > 0 || snapshotReference) {
    await prisma.tradeOption.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }

  await prisma.tradeOption.delete({ where: { id } });
  return NextResponse.json({ ok: true, deactivated: false });
}
