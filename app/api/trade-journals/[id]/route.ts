import { withSqliteErrors } from "@/lib/sqlite-write-response";
import { retrySqliteWrite } from "@/lib/sqlite-write";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { removeJournalScreenshots } from "@/lib/trade-journal/storage";
import { tradeJournalSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const journal = await prisma.tradeJournal.findUnique({
    where: { id },
    include: {
      dataset: {
        include: {
          trades: {
            orderBy: [{ date: "asc" }, { createdAt: "asc" }],
            include: { instrumentOption: true, strategyOption: true },
          },
          _count: { select: { simulationRuns: true } },
        },
      },
    },
  });
  if (!journal) {
    return NextResponse.json({ error: copy.api.journalNotFound }, { status: 404 });
  }
  return NextResponse.json(journal);
}

async function handlePATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = tradeJournalSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const journal = await prisma.tradeJournal.findUnique({ where: { id } });
  if (!journal) {
    return NextResponse.json({ error: copy.api.journalNotFound }, { status: 404 });
  }

  const description = parsed.data.description || null;
  const updated = await sqliteWriteTransaction(prisma, async (tx) => {
    await tx.tradeDataset.update({
      where: { id: journal.datasetId },
      data: {
        name: `交易日志 · ${parsed.data.name}`,
        description,
      },
    });

    return tx.tradeJournal.update({
      where: { id },
      data: {
        name: parsed.data.name,
        description,
      },
    });
  });

  return NextResponse.json(updated);
}

async function handleDELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const journal = await prisma.tradeJournal.findUnique({ where: { id } });
  if (!journal) {
    return NextResponse.json({ error: copy.api.journalNotFound }, { status: 404 });
  }

  await retrySqliteWrite(() => prisma.tradeDataset.delete({ where: { id: journal.datasetId } }));
  await removeJournalScreenshots(id);
  return NextResponse.json({ ok: true });
}

export const PATCH = withSqliteErrors(handlePATCH);

export const DELETE = withSqliteErrors(handleDELETE);
