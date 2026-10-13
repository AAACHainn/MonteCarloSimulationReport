import { prisma } from "@/lib/db";
import { runView } from "@/lib/market-sync/service";
import { SyncError } from "@/lib/market-sync/security";
import { syncApi } from "@/lib/market-sync/api";
import { copy } from "@/lib/i18n";
type Context = { params: Promise<{ runId: string }> };
export function GET(request: Request, context: Context) { return syncApi(request, async () => { const run = await prisma.marketDataSyncRun.findUnique({ where: { id: (await context.params).runId } }); if (!run) throw new SyncError(copy.marketSync.missing, 404); return runView(run); }); }
