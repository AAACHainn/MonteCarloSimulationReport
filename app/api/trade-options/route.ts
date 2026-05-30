import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tradeOptionSchema } from "@/lib/validations";

export async function GET() {
  return NextResponse.json(
    await prisma.tradeOption.findMany({
      orderBy: [{ type: "asc" }, { active: "desc" }, { name: "asc" }],
    }),
  );
}

export async function POST(request: Request) {
  const parsed = tradeOptionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const option = await prisma.tradeOption.upsert({
    where: { type_name: parsed.data },
    update: { active: true },
    create: parsed.data,
  });
  return NextResponse.json(option, { status: 201 });
}
