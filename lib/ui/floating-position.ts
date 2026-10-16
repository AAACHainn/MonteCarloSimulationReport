export type FloatingPosition = { x: number; y: number };

export function parseFloatingPosition(value: string | null): FloatingPosition | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && !Array.isArray(parsed) && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: parsed.x, y: parsed.y } : null;
  } catch { return null; }
}

export function fitFloatingPosition(position: FloatingPosition, viewport: { width: number; height: number }, size = 48, margin = 16): FloatingPosition {
  const fit = (value: number, extent: number) => {
    const room = Math.max(0, extent - size), inset = Math.min(margin, room / 2);
    return Math.min(Math.max(value, inset), room - inset);
  };
  return { x: fit(position.x, viewport.width), y: fit(position.y, viewport.height) };
}
