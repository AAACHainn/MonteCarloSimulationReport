import { prisma } from "@/lib/db";
import { runView } from "@/lib/market-sync/service";
import { syncApi } from "@/lib/market-sync/api";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) { return syncApi(request, async () => (await prisma.marketDataSyncRun.findMany({ where: { datasetId: (await context.params).id }, orderBy: { createdAt: "desc" }, take: 20 })).map(runView)); }
