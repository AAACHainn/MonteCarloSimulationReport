import { isValidAbcdGeometry, type AbcdGeometry, type DrawingAnchor } from "./chart-drawings";

export type AbcdDraft = { geometry: AbcdGeometry; stage: "b" | "c" };
export type AbcdPoint = { x: number; y: number };
export type AbcdCoordinates = Record<keyof AbcdGeometry, AbcdPoint>;
export type AbcdHitPart = keyof AbcdGeometry | "line";

export function advanceAbcdDraft(draft: AbcdDraft | null, anchor: DrawingAnchor): { draft: AbcdDraft | null; complete: AbcdGeometry | null } {
  if (!draft) return { draft: { geometry: { a: anchor, b: anchor, c: anchor }, stage: "b" }, complete: null };
  if (draft.stage === "b") return draft.geometry.a.price === anchor.price ? { draft, complete: null }
    : { draft: { geometry: { a: draft.geometry.a, b: anchor, c: anchor }, stage: "c" }, complete: null };
  const geometry = { ...draft.geometry, c: anchor };
  return isValidAbcdGeometry(geometry) ? { draft: null, complete: geometry } : { draft, complete: null };
}

export function previewAbcdDraft(draft: AbcdDraft, anchor: DrawingAnchor): AbcdDraft {
  return { ...draft, geometry: draft.stage === "b" ? { a: draft.geometry.a, b: anchor, c: anchor } : { ...draft.geometry, c: anchor } };
}

/** Preserve untouched source anchors even when their display bucket has changed. */
export function moveAbcdGeometry(geometry: AbcdGeometry, coordinates: AbcdCoordinates, part: AbcdHitPart,
  dx: number, dy: number, anchorAt: (point: AbcdPoint) => { anchor: DrawingAnchor; coordinate: AbcdPoint } | null): AbcdGeometry | null {
  const next = { ...geometry };
  for (const key of ["a", "b", "c"] as const) {
    if (part !== "line" && part !== key) continue;
    const origin = coordinates[key];
    const positioned = anchorAt({ x: origin.x + dx, y: origin.y + dy });
    if (!positioned) return null;
    const original = geometry[key], anchor = { ...positioned.anchor };
    if (dx === 0 || positioned.coordinate.x === origin.x) { anchor.timestamp = original.timestamp; anchor.sourceSequence = original.sourceSequence; }
    if (dy === 0 || positioned.coordinate.y === origin.y) anchor.price = original.price;
    next[key] = anchor;
  }
  return isValidAbcdGeometry(next) ? next : null;
}
