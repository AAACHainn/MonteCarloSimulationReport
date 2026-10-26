import { NextResponse } from "next/server";
import { requireProfile, userErrorResponse } from "@/lib/user-growth/service";
import { readUserWallet } from "@/lib/user-wallet/read";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await context.params; await requireProfile(userId);
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await readUserWallet(userId, Number(params.get("page") ?? 1), Number(params.get("accountsPage") ?? 1)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userErrorResponse(error); }
}
