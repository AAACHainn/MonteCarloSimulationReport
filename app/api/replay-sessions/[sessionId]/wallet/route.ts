import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { loadReplayScope, runWithReplayScope, replayErrorResponse } from "@/lib/replay-sessions/scope";
import { sessionWalletPreview } from "@/lib/user-wallet/session";
import { transferStandardAccount } from "@/lib/user-wallet/transfers";
type Context = { params: Promise<{ sessionId: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: Context) {
  try { const scope = await loadReplayScope((await context.params).sessionId); return NextResponse.json(await runWithReplayScope(scope, () => prisma.$transaction(tx => sessionWalletPreview(tx))), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return replayErrorResponse(error); }
}
const schema = z.object({ userId: z.string().min(1), kind: z.enum(["DEPOSIT", "WITHDRAW"]), amount: z.number().finite().positive().refine(value => Number(value.toFixed(2)) === value), expectedVersion: z.number().int().positive(), requestId: z.string().min(1).max(128) }).strict();
export async function POST(request: Request, context: Context) {
  try {
    const input = schema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: copy.userWallet.transferInvalid }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    const result = await runWithReplayScope(scope, () => sqliteWriteTransaction(prisma, tx => transferStandardAccount(tx, input.data)));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { if (error instanceof SyntaxError) return NextResponse.json({ error: copy.userWallet.transferInvalid }, { status: 400 }); return replayErrorResponse(error); }
}
