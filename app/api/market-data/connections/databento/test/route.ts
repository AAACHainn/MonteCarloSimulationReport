import { testConnection } from "@/lib/market-sync/service";
import { syncApi } from "@/lib/market-sync/api";
export const runtime = "nodejs";
export function POST(request: Request) { return syncApi(request, testConnection); }
