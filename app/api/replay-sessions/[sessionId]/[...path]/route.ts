import { NextResponse } from "next/server";
import { loadReplayScope, runWithReplayScope, replayErrorResponse } from "@/lib/replay-sessions/scope";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type LegacyContext = { params: Promise<{ id: string; orderId: string; entryId: string; drawingId: string; sessionId: string }> };
type LegacyRoute = Partial<Record<Method, (request: Request, context: LegacyContext) => Promise<Response>>>;
type Context = { params: Promise<{ sessionId: string; path: string[] }> };

// Reuse the existing route implementations under an explicit session context.
const routes: Record<string, () => Promise<LegacyRoute>> = {
  progress: () => import("@/app/api/market-datasets/[id]/progress/route"),
  account: () => import("@/app/api/market-datasets/[id]/paper-session/route"),
  "account/history": () => import("@/app/api/market-datasets/[id]/paper-session/history/route"),
  orders: () => import("@/app/api/market-datasets/[id]/paper-session/orders/route"),
  "orders/[orderId]": () => import("@/app/api/market-datasets/[id]/paper-session/orders/[orderId]/route"),
  sync: () => import("@/app/api/market-datasets/[id]/replay/sync/route"),
  advance: () => import("@/app/api/market-datasets/[id]/replay/advance/route"),
  start: () => import("@/app/api/market-datasets/[id]/replay/start/route"),
  reset: () => import("@/app/api/market-datasets/[id]/replay/reset/route"),
  journal: () => import("@/app/api/market-datasets/[id]/paper-journal/route"),
  "journal/annotations": () => import("@/app/api/market-datasets/[id]/paper-journal/annotations/route"),
  "journal/entries/[entryId]": () => import("@/app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route"),
  drawings: () => import("@/app/api/market-datasets/[id]/drawings/route"),
  "drawings/[drawingId]": () => import("@/app/api/market-datasets/[id]/drawings/[drawingId]/route"),
};

async function dispatch(request: Request, context: Context) {
  try {
    const { sessionId, path } = await context.params;
    const scope = await loadReplayScope(sessionId);
    let key = path.join("/");
    const identifiers = { orderId: "", entryId: "", drawingId: "", sessionId: "" };
    if (path.length === 2 && path[0] === "orders") { key = "orders/[orderId]"; identifiers.orderId = path[1]; }
    if (path.length === 2 && path[0] === "drawings") { key = "drawings/[drawingId]"; identifiers.drawingId = path[1]; }
    if (path.length === 3 && path[0] === "journal" && path[1] === "entries") {
      key = "journal/entries/[entryId]"; identifiers.entryId = path[2];
    }
    const loader = routes[key];
    if (!loader) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    const handler = (await loader())[request.method as Method];
    if (!handler) return NextResponse.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405 });
    return await runWithReplayScope(scope, () => handler(request, { params: Promise.resolve({ id: scope.datasetId, ...identifiers }) }));
  } catch (error) { return replayErrorResponse(error); }
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
