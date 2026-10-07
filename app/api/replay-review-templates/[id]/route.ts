import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { normalizeReviewTemplateKey } from "@/lib/paper-trading/review-templates";
import { reviewTemplateRenameSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = reviewTemplateRenameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const template = await prisma.replayReviewTemplate.update({
      where: { id },
      data: { name: parsed.data.name, normalizedName: normalizeReviewTemplateKey(parsed.data.name) },
      select: { id: true, name: true, content: true },
    });
    return NextResponse.json(template);
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError) {
      if (cause.code === "P2002") return NextResponse.json({ error: copy.paperTrading.reviewTemplateNameExists }, { status: 409 });
      if (cause.code === "P2025") return NextResponse.json({ error: copy.paperTrading.reviewTemplateNotFound }, { status: 404 });
    }
    return NextResponse.json({ error: copy.paperTrading.reviewTemplateRenameFailed }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await prisma.replayReviewTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2025") {
      return NextResponse.json({ error: copy.paperTrading.reviewTemplateNotFound }, { status: 404 });
    }
    return NextResponse.json({ error: copy.paperTrading.reviewTemplateDeleteFailed }, { status: 500 });
  }
}
