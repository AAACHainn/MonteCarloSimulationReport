import { getConnection, saveConnection } from "@/lib/market-sync/service";
import { syncApi } from "@/lib/market-sync/api";
export const runtime = "nodejs";
export function GET(request: Request) { return syncApi(request, getConnection); }
export function PUT(request: Request) { return syncApi(request, async () => saveConnection(await request.json())); }
