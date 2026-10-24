import { NextResponse } from "next/server";
import { z } from "zod";
import { copy } from "@/lib/i18n";
import { loadReplayScope, runWithReplayScope, replayErrorResponse } from "@/lib/replay-sessions/scope";
import { resetPropAccount } from "@/lib/prop-practice/rounds";
const schema = z.object({ expectedVersion: z.number().int().positive(), expectedProjectionId: z.string().min(1), requestId: z.string().uuid() }).strict();
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: copy.propPractice.resetUnavailable }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    return await runWithReplayScope(scope, async () => NextResponse.json({ round: await resetPropAccount(parsed.data) }));
  } catch (error) { return replayErrorResponse(error); }
}
