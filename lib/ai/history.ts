import { prisma } from "@/lib/db";
import type { ContextValue } from "./context";

// A fresh request may have a new snapshot ID. Only the same business object may supply historical text.
export async function relevantHistory(conversationId: string, context: Pick<ContextValue, "replaySessionId" | "projectionId" | "selectedEntryId"> | null, runId: string, before?: Date) {
  const rows = await prisma.aiMessage.findMany({ where: { conversationId, status: "COMPLETED", runId: { not: runId },
    ...(before ? { createdAt: { lt: before } } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30 });
  const contexts = await prisma.aiContext.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.contextId ? [r.contextId] : []))] } }, select: { id: true, value: true } });
  const allowed = new Set(contexts.filter((c) => {
    const value: ContextValue = JSON.parse(c.value);
    return context && value.replaySessionId === context.replaySessionId && value.projectionId === context.projectionId
      && value.selectedEntryId === context.selectedEntryId;
  }).map((c) => c.id));
  let length = 0;
  return rows.filter((r) => {
    if (context ? !r.contextId || !allowed.has(r.contextId) : Boolean(r.contextId)) return false;
    if (length + r.content.length > 8000) return false;
    length += r.content.length; return true;
  }).slice(0, 12).reverse();
}
