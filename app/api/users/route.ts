import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { userIdentity, userErrorResponse } from "@/lib/user-growth/service";
import { saveProfileRequest } from "@/lib/user-growth/profile-request";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ users: (await prisma.userProfile.findMany({ include: { growth: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(userIdentity) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return userErrorResponse(error); }
}
export async function POST(request: Request) {
  try { return NextResponse.json({ user: await saveProfileRequest(request) }, { status: 201 }); }
  catch (error) { return userErrorResponse(error); }
}
