import { enqueueSync } from "@/lib/market-sync/service";
import { startMarketSyncRuntime } from "@/lib/market-sync/runtime";
import { syncApi } from "@/lib/market-sync/api";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) { return syncApi(request, async () => { const run = await enqueueSync((await context.params).id); void startMarketSyncRuntime()?.tick(); return run; }, 202); }
