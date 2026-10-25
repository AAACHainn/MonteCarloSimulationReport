import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { profileInput, saveProfile, userIdentity, userErrorResponse } from "@/lib/user-growth/service";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ users: (await prisma.userProfile.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(userIdentity) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return userErrorResponse(error); }
}
export async function POST(request: Request) {
  try { return NextResponse.json({ user: await saveProfile(profileInput.parse(await request.json())) }, { status: 201 }); }
  catch (error) { return userErrorResponse(error); }
}
