import { NextResponse } from "next/server";
import { z } from "zod";
import { loadReplayScope, runWithReplayScope, replayErrorResponse } from "@/lib/replay-sessions/scope";
import { confirmPropPromotion } from "@/lib/prop-practice/service";
import { copy } from "@/lib/i18n";

const schema = z.object({ expectedVersion: z.number().int().positive(), requestId: z.string().uuid() }).strict();
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: copy.propPractice.promotionUnavailable }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    return await runWithReplayScope(scope, async () => NextResponse.json({ promotion: await confirmPropPromotion(parsed.data) }));
  } catch (error) { return replayErrorResponse(error); }
}
