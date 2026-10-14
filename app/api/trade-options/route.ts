import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tradeOptionSchema } from "@/lib/validations";
import { parseChecklist } from "@/lib/paper-trading/training-gate";
import { copy } from "@/lib/i18n";
export async function GET() {
  const options = await prisma.tradeOption.findMany({ orderBy: [{ type: "asc" }, { active: "desc" }, { name: "asc" }] });
  return NextResponse.json(options.map((option) => ({ ...option, checklist: parseChecklist(option.checklist) })));
}
export async function POST(request: Request) {
  const parsed = tradeOptionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: copy.trainingGate.itemRequired }, { status: 400 });
  const { type, name, checklist } = parsed.data;
  if (type !== "STRATEGY" && checklist) return NextResponse.json({ error: copy.replaySessions.invalid }, { status: 400 });
  const option = await prisma.tradeOption.upsert({ where: { type_name: { type, name } }, update: { active: true },
    create: { type, name, ...(checklist ? { checklist: JSON.stringify(checklist) } : {}) } });
  return NextResponse.json({ ...option, checklist: parseChecklist(option.checklist) }, { status: 201 });
}
