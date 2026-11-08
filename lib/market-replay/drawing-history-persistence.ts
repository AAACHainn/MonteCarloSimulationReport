import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createMarketDrawingSchema, DRAWING_TYPES, serializeMarketDrawing, type MarketDrawing } from "./chart-drawings";
import { sameDrawingSnapshot } from "./drawing-history";
import { ReplaySessionError } from "@/lib/replay-sessions/scope";
import { copy } from "@/lib/i18n";

const snapshotSchema = z.object({ id: z.string().min(1).max(200), datasetId: z.string().min(1), type: z.enum(DRAWING_TYPES),
  geometry: z.unknown(), style: z.unknown(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict().superRefine((value, ctx) => {
  if (!createMarketDrawingSchema.safeParse({ type: value.type, geometry: value.geometry, style: value.style }).success) ctx.addIssue({ code: "custom", message: "Invalid drawing" });
});
export const drawingChangesSchema = z.object({ changes: z.array(z.object({ id: z.string().min(1).max(200), before: snapshotSchema.nullable(), after: snapshotSchema.nullable() }).strict()
  .refine(change => Boolean(change.before || change.after) && (!change.before || change.before.id === change.id) && (!change.after || change.after.id === change.id)))
  .min(1).max(20_000) }).strict().refine(value => new Set(value.changes.map(change => change.id)).size === value.changes.length);

/** Caller holds a SQLite write transaction and the normal drawing scope guard. */
export async function applyDrawingChanges(tx: Prisma.TransactionClient, datasetId: string, replaySessionId: string | null,
  changes: { id: string; before: MarketDrawing | null; after: MarketDrawing | null }[]) {
  const conflict = () => new ReplaySessionError("DRAWING_HISTORY_CONFLICT", 409, copy.marketReplay.drawingEditing.conflict);
  const stored = await tx.marketDrawing.findMany({ where: { id: { in: changes.map(change => change.id) } } });
  if (stored.some(row => row.datasetId !== datasetId || row.replaySessionId !== replaySessionId)
    || changes.some(change => [change.before, change.after].some(row => row && row.datasetId !== datasetId))) throw conflict();
  const actual = new Map(stored.map(row => [row.id, serializeMarketDrawing(row)]));
  const matches = (side: "before" | "after") => changes.every(change => sameDrawingSnapshot(actual.get(change.id) ?? null, change[side]));
  // Also accepts a retry after a successful transaction whose response was lost.
  if (!matches("after")) {
    if (!matches("before")) throw conflict();
    const removed = changes.filter(change => !change.after).map(change => change.id);
    if (removed.length) await tx.marketDrawing.deleteMany({ where: { id: { in: removed }, datasetId, replaySessionId } });
    const creates: Prisma.MarketDrawingCreateManyInput[] = [];
    for (const change of changes) {
      if (!change.after) continue;
      const row = change.after;
      const data = { type: row.type, geometry: JSON.stringify(row.geometry), style: JSON.stringify(row.style), createdAt: new Date(row.createdAt) };
      if (actual.has(row.id)) await tx.marketDrawing.update({ where: { id: row.id }, data });
      else creates.push({ ...data, id: row.id, datasetId, replaySessionId });
    }
    if (creates.length) await tx.marketDrawing.createMany({ data: creates });
  }
  const restored = await tx.marketDrawing.findMany({ where: { id: { in: changes.filter(change => change.after).map(change => change.id) }, datasetId, replaySessionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { drawings: restored.map(serializeMarketDrawing), deletedIds: changes.filter(change => !change.after).map(change => change.id) };
}
