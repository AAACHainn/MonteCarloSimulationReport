import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { loadReplayScope, runWithReplayScope, assertSessionMetadataWritable, replayErrorResponse, ReplaySessionError } from "@/lib/replay-sessions/scope";
import { archiveReplaySession } from "@/lib/replay-sessions/service";
import { sessionWalletPreview } from "@/lib/user-wallet/session";
import { settleStandardAccount, walletManaged, moneyValue } from "@/lib/user-wallet/service";
type Context = { params: Promise<{ sessionId: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: Context) {
  try { const scope = await loadReplayScope((await context.params).sessionId); return NextResponse.json(await runWithReplayScope(scope, () => prisma.$transaction(tx => sessionWalletPreview(tx))), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return replayErrorResponse(error); }
}
const schema = z.object({ expectedVersion: z.number().int().positive(), requestId: z.string().min(1).max(128) }).strict();
export async function POST(request: Request, context: Context) {
  try {
    const input = schema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: copy.userWallet.conflict }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    const amount = await runWithReplayScope(scope, () => sqliteWriteTransaction(prisma, async tx => {
      const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
      if (!walletManaged(owner) || owner.accountCategory !== "STANDARD") throw new ReplaySessionError("WALLET_EXCLUDED", 409, copy.userWallet.excluded);
      const allocation = await tx.userWalletAllocation.findUnique({ where: { projectionId: scope.projectionId } });
      if (allocation?.settledAt) return moneyValue(allocation.withdrawnMinor);
      await assertSessionMetadataWritable(tx);
      if (owner.version !== input.data.expectedVersion) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.userWallet.conflict);
      const result = await settleStandardAccount(tx, owner, scope.projectionId);
      if (!result) throw new ReplaySessionError("WALLET_NO_ACCOUNT", 409, copy.userWallet.conflict);
      if (owner.status === "ACTIVE") await archiveReplaySession(tx);
      return moneyValue(result.amount);
    }));
    return NextResponse.json({ ok: true, amount });
  } catch (error) { return replayErrorResponse(error); }
}
