import { DEFAULT_ABCD_STYLE, type AbcdDrawing } from "./chart-drawings";

// Keep the stored JSON compatible while the AB=CD editor exposes only its two fixed lines.
export function abcdSettingsStyle(style: AbcdDrawing["style"]): AbcdDrawing["style"] {
  const color = style.singleColor ?? style.levels.find(level => level.value === 1)?.color
    ?? style.levels[0]?.color ?? DEFAULT_ABCD_STYLE.singleColor!;
  return { ...style, singleColor: color, levels: [
    { value: 0, enabled: true, color },
    { value: 1, enabled: true, color },
  ] };
}
