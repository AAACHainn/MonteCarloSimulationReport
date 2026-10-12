export type DialogResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type DialogBounds = { left: number; top: number; width: number; height: number };
export type DialogViewport = { width: number; height: number };

export const DIALOG_VIEWPORT_MARGIN = 16;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 320;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function dialogSizeLimits(viewport: DialogViewport) {
  const maximumWidth = Math.max(1, viewport.width - DIALOG_VIEWPORT_MARGIN * 2);
  const maximumHeight = Math.max(1, viewport.height - DIALOG_VIEWPORT_MARGIN * 2);
  return {
    minimumWidth: Math.min(MIN_WIDTH, maximumWidth),
    minimumHeight: Math.min(MIN_HEIGHT, maximumHeight),
    maximumWidth,
    maximumHeight,
  };
}

export function fitDialogBounds(bounds: DialogBounds, viewport: DialogViewport): DialogBounds {
  const limits = dialogSizeLimits(viewport);
  const width = clamp(bounds.width, limits.minimumWidth, limits.maximumWidth);
  const height = clamp(bounds.height, limits.minimumHeight, limits.maximumHeight);
  return {
    width,
    height,
    left: clamp(bounds.left, DIALOG_VIEWPORT_MARGIN, viewport.width - DIALOG_VIEWPORT_MARGIN - width),
    top: clamp(bounds.top, DIALOG_VIEWPORT_MARGIN, viewport.height - DIALOG_VIEWPORT_MARGIN - height),
  };
}

export function resizeDialogBounds(
  start: DialogBounds,
  edge: DialogResizeEdge,
  deltaX: number,
  deltaY: number,
  viewport: DialogViewport,
): DialogBounds {
  const bounds = fitDialogBounds(start, viewport);
  const limits = dialogSizeLimits(viewport);
  let { left, top, width, height } = bounds;
  if (edge.includes("e")) {
    width = clamp(bounds.width + deltaX, limits.minimumWidth, viewport.width - DIALOG_VIEWPORT_MARGIN - left);
  }
  if (edge.includes("s")) {
    height = clamp(bounds.height + deltaY, limits.minimumHeight, viewport.height - DIALOG_VIEWPORT_MARGIN - top);
  }
  if (edge.includes("w")) {
    const right = bounds.left + bounds.width;
    left = clamp(bounds.left + deltaX, DIALOG_VIEWPORT_MARGIN, right - limits.minimumWidth);
    width = right - left;
  }
  if (edge.includes("n")) {
    const bottom = bounds.top + bounds.height;
    top = clamp(bounds.top + deltaY, DIALOG_VIEWPORT_MARGIN, bottom - limits.minimumHeight);
    height = bottom - top;
  }
  return { left, top, width, height };
}

export function moveDialogBounds(start: DialogBounds, deltaX: number, deltaY: number, viewport: DialogViewport): DialogBounds {
  const bounds = fitDialogBounds(start, viewport);
  return {
    ...bounds,
    left: clamp(bounds.left + deltaX, DIALOG_VIEWPORT_MARGIN, viewport.width - DIALOG_VIEWPORT_MARGIN - bounds.width),
    top: clamp(bounds.top + deltaY, DIALOG_VIEWPORT_MARGIN, viewport.height - DIALOG_VIEWPORT_MARGIN - bounds.height),
  };
}

export function parseDialogDimension(value: string | null) {
  if (!value) return null;
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}
