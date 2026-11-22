import { NextResponse } from "next/server";
import { z } from "zod";
import { copy } from "@/lib/i18n";
import { assertSameOrigin, SyncError } from "@/lib/market-sync/security";
import { sqliteErrorResponse } from "@/lib/sqlite-write-response";
import { AchievementError } from "./jobs";

export const pathId = z.string().min(1).max(128);
export const cursorInput = z.object({ after: pathId.optional() }).strict();

export async function parseAchievementRequest<T>(request: Request, schema: z.ZodType<T>) {
  assertSameOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) {
    throw new AchievementError("INVALID_REQUEST", 400);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "", bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        throw new AchievementError("INVALID_REQUEST", 413);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  return schema.parse(JSON.parse(body + decoder.decode()));
}

export async function achievementJson(action: () => Promise<unknown>) {
  try { return NextResponse.json(await action(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const busy = sqliteErrorResponse(error);
    if (busy) return busy;
    let code = "BATCH_FAILED", status = 500;
    if (error instanceof AchievementError) { code = error.code; status = error.status; }
    else if (error instanceof z.ZodError || error instanceof SyntaxError) { code = "INVALID_REQUEST"; status = 400; }
    else if (error instanceof SyncError && error.status === 403) { code = "ORIGIN"; status = 403; }
    else console.error("Achievement request failed", error);
    const errors = copy.achievements.admin.errors;
    return NextResponse.json({ code, error: errors[code as keyof typeof errors] ?? copy.achievements.error }, { status });
  }
}
