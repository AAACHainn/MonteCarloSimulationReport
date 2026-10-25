import { NextResponse } from "next/server";
import { sessionPage, userErrorResponse } from "@/lib/user-growth/service";
export async function GET(request: Request) {
  try { return NextResponse.json(await sessionPage(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return userErrorResponse(error); }
}
