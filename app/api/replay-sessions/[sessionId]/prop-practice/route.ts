import { NextResponse } from "next/server";
import { z } from "zod";
import { loadReplayScope, runWithReplayScope, replayErrorResponse } from "@/lib/replay-sessions/scope";
import { readPropAccount, confirmPropPayout } from "@/lib/prop-practice/service";
import { copy } from "@/lib/i18n";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const scope = await loadReplayScope((await context.params).sessionId);
    return await runWithReplayScope(scope, async () => NextResponse.json({ account: await readPropAccount(), version: scope.version, status: scope.status },
      new URL(request.url).searchParams.get("download") === "1" ? { headers: { "Content-Disposition": `attachment; filename="prop-ledger-${scope.id}.json"` } } : undefined));
  } catch (error) { return replayErrorResponse(error); }
}
const schema = z.object({ expectedVersion: z.number().int().positive(), requestId: z.string().uuid(), amount: z.number().finite().positive().max(1e9) }).strict();
export async function POST(request: Request, context: Context) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: copy.propPractice.payoutInvalid }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    return await runWithReplayScope(scope, async () => NextResponse.json({ payout: await confirmPropPayout(parsed.data) }));
  } catch (error) { return replayErrorResponse(error); }
}
