import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "请使用 /bars/window 按窗口读取行情。" }, { status: 410 });
}
