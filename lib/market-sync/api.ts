import { NextResponse } from "next/server";
import { copy } from "@/lib/i18n";
import { assertSameOrigin, SyncError } from "./security";
export async function syncApi(request: Request, action: () => Promise<unknown>, status = 200) {
  try {
    if (!["GET", "HEAD"].includes(request.method)) assertSameOrigin(request);
    return NextResponse.json(await action(), { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyncError ? error.message : error instanceof SyntaxError ? copy.marketSync.invalid : copy.marketSync.failed }, { status: error instanceof SyncError ? error.status : error instanceof SyntaxError ? 400 : 500 });
  }
}
