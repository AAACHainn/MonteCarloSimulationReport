import { NextResponse } from "next/server";
import { assignHistory, assignmentInput, userErrorResponse } from "@/lib/user-growth/service";
export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  try { const input = assignmentInput.parse(await request.json()); return NextResponse.json(await assignHistory((await context.params).userId, input.sessionIds)); }
  catch (error) { return userErrorResponse(error); }
}
