import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile, userErrorResponse } from "@/lib/user-growth/service";
import { readGrowthRecords } from "@/lib/user-growth/read";
const query = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), snapshot: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() });
export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await context.params; await requireProfile(userId);
    const params = new URL(request.url).searchParams;
    const input = query.parse({ page: params.get("page") ?? undefined, snapshot: params.get("snapshot") ?? undefined });
    return NextResponse.json(await readGrowthRecords(userId, input.page, input.snapshot), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userErrorResponse(error); }
}
