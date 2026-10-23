import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePropTemplate, listPropTemplates, savePropTemplate } from "@/lib/prop-practice/service";
import { propRulesSchema } from "@/lib/prop-practice/rules";
import { replayErrorResponse } from "@/lib/replay-sessions/scope";
import { copy } from "@/lib/i18n";

export async function GET() {
  try { return NextResponse.json({ templates: await listPropTemplates() }); }
  catch (error) { return replayErrorResponse(error); }
}
const identitySchema = z.object({ id: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
const schema = identitySchema.partial().extend({ active: z.boolean(), rules: propRulesSchema }).strict()
  .refine(input => (input.id !== undefined) === (input.expectedVersion !== undefined));
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: copy.propPractice.invalidRules }, { status: 400 });
    const { rules, id, expectedVersion, active } = parsed.data;
    return NextResponse.json({ template: await savePropTemplate(rules, id, expectedVersion, active) }, { status: 201 });
  } catch (error) { return replayErrorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const parsed = identitySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: copy.propPractice.invalidRules }, { status: 400 });
    await deletePropTemplate(parsed.data.id, parsed.data.expectedVersion);
    return NextResponse.json({ deleted: true });
  } catch (error) { return replayErrorResponse(error); }
}
