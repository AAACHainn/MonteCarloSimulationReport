import { NextResponse } from "next/server";
import { z } from "zod";
import { breakthroughFoundation } from "@/lib/user-growth/settlement";
import { userErrorResponse } from "@/lib/user-growth/service";
export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const text = await request.text(); z.object({}).strict().parse(text ? JSON.parse(text) : {});
    return NextResponse.json(await breakthroughFoundation((await context.params).userId));
  } catch (error) { return userErrorResponse(error); }
}
