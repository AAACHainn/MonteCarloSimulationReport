import { sqliteErrorResponse } from "@/lib/sqlite-write-response";
import { NextResponse } from "next/server";
import { copy } from "@/lib/i18n";
import { assertSameOrigin } from "@/lib/market-sync/security";
import type { BudgetBlock } from "./limits";
export class AiError extends Error {
  budget?: BudgetBlock;
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function aiError(error: unknown) {
  const busy = sqliteErrorResponse(error); if (busy) return busy;
  if (error instanceof AiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: copy.ai.failed, code: "INTERNAL" }, { status: 500 });
}
export function assertOrigin(request: Request) {
  try { assertSameOrigin(request); }
  catch { throw new AiError("ORIGIN", copy.ai.origin, 403); }
}
export async function readBody(request: Request, limit = 100000) {
  if (!request.body) throw new AiError("INVALID", copy.ai.invalid);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
      if (size > limit) throw new AiError("TOO_LARGE", copy.ai.tooLarge, 413);
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof AiError) throw error;
    throw new AiError("INVALID", copy.ai.invalid);
  } finally { reader.releaseLock(); }
}
