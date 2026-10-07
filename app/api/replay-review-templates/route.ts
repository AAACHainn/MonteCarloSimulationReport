import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { normalizeReviewTemplateKey } from "@/lib/paper-trading/review-templates";
import { reviewTemplateSchema } from "@/lib/validations";

const TEMPLATE_SELECT = { id: true, name: true, content: true } as const;

export async function GET() {
  return NextResponse.json(await prisma.replayReviewTemplate.findMany({
    orderBy: { name: "asc" }, select: TEMPLATE_SELECT,
  }));
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = reviewTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const template = await prisma.replayReviewTemplate.create({
      data: { ...parsed.data, normalizedName: normalizeReviewTemplateKey(parsed.data.name) },
      select: TEMPLATE_SELECT,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      return NextResponse.json({ error: copy.paperTrading.reviewTemplateNameExists }, { status: 409 });
    }
    return NextResponse.json({ error: copy.paperTrading.reviewTemplateSaveFailed }, { status: 500 });
  }
}
