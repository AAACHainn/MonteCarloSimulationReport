import { LineStyle, type LineWidth } from "lightweight-charts";
import {
  EMA_LINE_STYLES,
  EMA_LINE_WIDTHS,
  type EmaIndicatorConfig,
  type EmaLineStyle,
  type EmaLineWidth,
} from "@/lib/market-replay/types";

export const DEFAULT_EMA_LINE_WIDTH: EmaLineWidth = 2;
export const DEFAULT_EMA_LINE_STYLE: EmaLineStyle = "SOLID";

export function normalizeEmaLineWidth(value: unknown): EmaLineWidth {
  return EMA_LINE_WIDTHS.includes(value as EmaLineWidth)
    ? value as EmaLineWidth
    : DEFAULT_EMA_LINE_WIDTH;
}

export function normalizeEmaLineStyle(value: unknown): EmaLineStyle {
  return EMA_LINE_STYLES.includes(value as EmaLineStyle)
    ? value as EmaLineStyle
    : DEFAULT_EMA_LINE_STYLE;
}

export function lightweightEmaLineStyle(value: EmaLineStyle): LineStyle {
  if (value === "DASHED") return LineStyle.Dashed;
  if (value === "DOTTED") return LineStyle.Dotted;
  return LineStyle.Solid;
}

export function emaSeriesStyleOptions(indicator: EmaIndicatorConfig): {
  color: string;
  lineWidth: LineWidth;
  lineStyle: LineStyle;
} {
  return {
    color: indicator.color,
    lineWidth: indicator.lineWidth,
    lineStyle: lightweightEmaLineStyle(indicator.lineStyle),
  };
}
