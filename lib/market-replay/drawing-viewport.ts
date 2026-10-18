type Point = { x: number; y: number };

export function segmentIntersectsViewport(start: Point, end: Point, width: number, height: number, padding = 7) {
  if (![start.x, start.y, end.x, end.y, width, height].every(Number.isFinite)) return false;
  let from = 0, to = 1;
  const dx = end.x - start.x, dy = end.y - start.y;
  for (const [p, q] of [[-dx, start.x + padding], [dx, width + padding - start.x],
    [-dy, start.y + padding], [dy, height + padding - start.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const ratio = q / p;
    if (p < 0) from = Math.max(from, ratio);
    else to = Math.min(to, ratio);
    if (from > to) return false;
  }
  return true;
}
