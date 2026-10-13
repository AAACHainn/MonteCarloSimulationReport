import { configView, saveConfig } from "@/lib/market-sync/service";
import { syncApi } from "@/lib/market-sync/api";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) { return syncApi(request, async () => configView((await context.params).id)); }
export function PUT(request: Request, context: Context) { return syncApi(request, async () => saveConfig((await context.params).id, await request.json())); }
