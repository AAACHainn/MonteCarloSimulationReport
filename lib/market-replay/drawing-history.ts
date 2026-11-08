import type { MarketDrawing } from "./chart-drawings";

export type DrawingAction = "create" | "paste" | "modify" | "style" | "template" | "line-width" | "text" | "delete" | "clear";
export type DrawingChange = { id: string; before: MarketDrawing | null; after: MarketDrawing | null };
export type DrawingHistoryEntry = { action: DrawingAction; changes: DrawingChange[] };
export type DrawingHistoryView = { undo: DrawingHistoryEntry | null; redo: DrawingHistoryEntry | null; busy: boolean; revision: number };
export const cloneDrawingValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** updatedAt changes when undo/redo writes the same content again. Compare the
 * complete editable content instead, including identity and original ordering. */
export function sameDrawingSnapshot(a: MarketDrawing | null, b: MarketDrawing | null) {
  if (!a || !b) return a === b;
  return a.id === b.id && a.datasetId === b.datasetId && a.type === b.type && a.createdAt === b.createdAt
    && JSON.stringify(canonical(a.geometry)) === JSON.stringify(canonical(b.geometry))
    && JSON.stringify(canonical(a.style)) === JSON.stringify(canonical(b.style));
}

/** One instance belongs to one mounted page/session/projection. Never persisted. */
export class DrawingHistory {
  constructor(readonly scope = "") {}
  private confirmed = new Map<string, MarketDrawing>();
  private undoEntries: DrawingHistoryEntry[] = [];
  private redoEntries: DrawingHistoryEntry[] = [];
  private textGroup: { key: string; id: string | null; changes: Map<string, DrawingChange> } | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private view: DrawingHistoryView = { undo: null, redo: null, busy: false, revision: 0 };
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getSnapshot = () => this.view;
  private publish(busy = this.view.busy) {
    this.view = { undo: this.undoEntries.at(-1) ?? null, redo: this.redoEntries.at(-1) ?? null, busy, revision: this.view.revision + 1 };
    this.listeners.forEach(listener => listener());
  }
  private push(entry: DrawingHistoryEntry) {
    const changes = entry.changes.filter(change => !sameDrawingSnapshot(change.before, change.after));
    if (!changes.length) return;
    this.undoEntries.push(cloneDrawingValue({ ...entry, changes }));
    if (this.undoEntries.length > 100) this.undoEntries.shift();
    this.redoEntries = [];
  }
  setTextGroup(key: string | null, id: string | null = null) {
    if (this.textGroup?.key === key) { if (id) this.textGroup.id = id; return; }
    if (this.textGroup) this.push({ action: "text", changes: [...this.textGroup.changes.values()] });
    this.textGroup = key ? { key, id, changes: new Map() } : null;
    this.publish();
  }
  seed(drawings: readonly MarketDrawing[]) {
    this.confirmed = new Map(drawings.map(drawing => [drawing.id, cloneDrawingValue(drawing)]));
  }
  record(changes: DrawingChange[], action: DrawingAction) {
    const changed = cloneDrawingValue(changes).filter(change => !sameDrawingSnapshot(change.before, change.after));
    for (const change of changed) {
      if (change.after) this.confirmed.set(change.id, change.after); else this.confirmed.delete(change.id);
    }
    const group = this.textGroup;
    if (group && action !== "style" && action !== "template" && changed.length && changed.every(change => (change.after ?? change.before)?.type === "TEXT" && (!group.id || group.id === change.id))) {
      for (const change of changed) {
        group.id = change.id;
        group.changes.set(change.id, { ...change, before: group.changes.has(change.id) ? group.changes.get(change.id)!.before : change.before });
      }
      this.redoEntries = [];
    } else {
      // Preserve chronological order if another object is edited while a text
      // editor is closing; subsequent text changes begin another segment.
      if (group?.changes.size) { this.push({ action: "text", changes: [...group.changes.values()] }); group.changes.clear(); }
      this.push({ action, changes: changed });
    }
    this.publish();
  }
  clear() { this.undoEntries = []; this.redoEntries = []; this.textGroup = null; this.publish(); }
  reset() { this.generation++; this.confirmed.clear(); this.undoEntries = []; this.redoEntries = []; this.textGroup = null; this.publish(false); }

  /** Observe confirmed drawing requests only. Existing UI rollback/preview and
   * session fetch headers stay owned by their current callers. */
  async observe(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const generation = this.generation;
    const path = typeof input === "string" ? new URL(input, "http://localhost").pathname : "";
    const match = /^\/api\/market-datasets\/[^/]+\/drawings(?:\/([^/]+))?$/.exec(path);
    if (!match || match[1] === "changes") return fetcher(input, init);
    const response = await fetcher(input, init);
    if (!response.ok) return response;
    const data = await response.clone().json().catch(() => null) as { drawing?: MarketDrawing; drawings?: MarketDrawing[]; historyBefore?: MarketDrawing | MarketDrawing[] } | null;
    if (!data || generation !== this.generation) return response;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") { if (data.drawings) this.seed(data.drawings); return response; }
    const header = new Headers(init?.headers).get("X-Drawing-Action") as DrawingAction | null;
    if (data.drawing) {
      const after = data.drawing, before = method === "PATCH" && data.historyBefore && !Array.isArray(data.historyBefore) ? data.historyBefore : this.confirmed.get(after.id) ?? null;
      const action = header ?? (method === "POST" ? "create" : before && JSON.stringify(canonical(before.geometry)) === JSON.stringify(canonical(after.geometry)) ? "style" : "modify");
      if (method === "POST" || before) this.record([{ id: after.id, before, after }], action);
    } else if (method === "DELETE") {
      const id = match[1] ? decodeURIComponent(match[1]) : null;
      let ids: string[] = id ? [id] : [];
      if (!id && typeof init?.body === "string") { try { ids = JSON.parse(init.body).ids ?? []; } catch { /* Invalid requests are rejected by the route. */ } }
      const removed = data.historyBefore ? Array.isArray(data.historyBefore) ? data.historyBefore : [data.historyBefore]
        : ids.flatMap(key => { const before = this.confirmed.get(key); return before ? [before] : []; });
      this.record(removed.map(before => ({ id: before.id, before, after: null })), id ? "delete" : "clear");
      if (data.drawings) this.seed(data.drawings);
    }
    return response;
  }

  async travel(direction: "undo" | "redo", fetcher: typeof fetch, datasetId: string): Promise<{ drawings: MarketDrawing[]; deletedIds: string[] }> {
    if (this.view.busy) throw new Error("DRAWING_HISTORY_BUSY");
    const entry = (direction === "undo" ? this.undoEntries : this.redoEntries).at(-1);
    if (!entry) return { drawings: [], deletedIds: [] };
    const changes = entry.changes.map(change => direction === "undo" ? { ...change, before: change.after, after: change.before } : change);
    const generation = this.generation;
    this.publish(true);
    try {
      const response = await fetcher(`/api/market-datasets/${datasetId}/drawings/changes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
      const data = await response.json() as { drawings?: MarketDrawing[]; deletedIds?: string[]; error?: string };
      if (generation !== this.generation) return { drawings: [], deletedIds: [] };
      if (!response.ok) {
        if (response.status === 409) { this.undoEntries = []; this.redoEntries = []; throw new Error("DRAWING_HISTORY_CONFLICT"); }
        throw new Error(data.error ?? "DRAWING_HISTORY_FAILED");
      }
      if (!Array.isArray(data.drawings) || !Array.isArray(data.deletedIds)) throw new Error("DRAWING_HISTORY_FAILED");
      for (const id of data.deletedIds) this.confirmed.delete(id);
      for (const drawing of data.drawings) this.confirmed.set(drawing.id, cloneDrawingValue(drawing));
      if (direction === "undo") { this.undoEntries.pop(); this.redoEntries.push(entry); }
      else { this.redoEntries.pop(); this.undoEntries.push(entry); }
      return { drawings: data.drawings, deletedIds: data.deletedIds };
    } finally { if (generation === this.generation) this.publish(false); }
  }
}
