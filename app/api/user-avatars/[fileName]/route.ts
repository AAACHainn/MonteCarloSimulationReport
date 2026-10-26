import { NextResponse } from "next/server";
import { readAvatar } from "@/lib/user-growth/avatar-storage";
import { copy } from "@/lib/i18n";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ fileName: string }> }) {
  try {
    const bytes = await readAvatar((await context.params).fileName);
    if (!bytes) return NextResponse.json({ error: copy.userGrowth.avatarMissing }, { status: 404 });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch { return NextResponse.json({ error: copy.userGrowth.avatarReadFailed }, { status: 500 }); }
}
