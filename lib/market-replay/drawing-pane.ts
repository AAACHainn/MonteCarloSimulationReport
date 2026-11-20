import { z } from "zod";

export const drawingPaneSchema = z.number().int().min(1).max(5);
export const drawingPaneHeader = "X-Replay-Drawing-Pane";

export function readDrawingPane(request: Request) {
  const value = request.headers.get(drawingPaneHeader);
  return value === null ? 1 : /^[1-5]$/.test(value) ? Number(value) : null;
}
