import { withSqliteErrors } from "@/lib/sqlite-write-response";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveTradeTags } from "@/lib/trade-journal/tag-service";
import { tradeTagsReplaceSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string; tradeId: string }> };

async function handlePATCH(request: Request, context: RouteContext) {
  const { id, tradeId } = await context.params;
  const parsed = tradeTagsReplaceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, dataset: { tradeJournal: { id } } },
    select: { id: true },
  });
  if (!trade) {
    return NextResponse.json({ error: "未找到交易记录。" }, { status: 404 });
  }

  const tags = await sqliteWriteTransaction(prisma, async (transaction) => {
    const resolvedTags = await resolveTradeTags(transaction, parsed.data.tags);
    const updated = await transaction.trade.update({
      where: { id: trade.id },
      data: { tags: { set: resolvedTags.map((tag) => ({ id: tag.id })) } },
      select: { tags: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
    });
    return updated.tags;
  });

  return NextResponse.json({ tags });
}

export const PATCH = withSqliteErrors(handlePATCH);
