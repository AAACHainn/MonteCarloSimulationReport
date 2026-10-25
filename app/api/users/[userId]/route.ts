import { readGrowthView } from "@/lib/user-growth/read";
import { realmLabel } from "@/lib/user-growth/presentation";
import { NextResponse } from "next/server";
import { profileInput, saveProfile, requireProfile, sessionPage, userErrorResponse } from "@/lib/user-growth/service";
type Context = { params: Promise<{ userId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { userId } = await context.params;
    const user = await requireProfile(userId);
    const growth = await readGrowthView(userId);
    return NextResponse.json({ user: { ...user, realmLabel: realmLabel(growth.realm === "foundation" ? "FOUNDATION" : growth.realm === "qi" ? "QI" : "MORTAL", growth.layer) }, sessions: await sessionPage(new URL(request.url).searchParams, userId), growth, growthConnected: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userErrorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { return NextResponse.json({ user: await saveProfile(profileInput.parse(await request.json()), (await context.params).userId) }); }
  catch (error) { return userErrorResponse(error); }
}
