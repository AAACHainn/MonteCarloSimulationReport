import { copy } from "@/lib/i18n";
import type { MarketDrawing } from "./chart-drawings";

export function drawingObjectName(drawing: MarketDrawing, index: number) {
  switch (drawing.type) {
    case "AB_CD": return copy.marketReplay.abcdObjectName(index);
    case "ARROW_UP": return copy.marketReplay.arrowUpObjectName(index);
    case "ARROW_DOWN": return copy.marketReplay.arrowDownObjectName(index);
    case "TEXT": return copy.marketReplay.textObjectName(index, Array.from(drawing.geometry.text.split("\n")[0]).slice(0, 24).join(""));
    case "RECTANGLE": return copy.marketReplay.rectangleObjectName(index);
    case "TREND_LINE": return copy.marketReplay.trendLineObjectName(index);
    case "FIB_RETRACEMENT": return copy.marketReplay.fibonacciObjectName(index);
  }
}
export function drawingObjectColor(drawing: MarketDrawing) {
  switch (drawing.type) {
    case "ARROW_UP": case "ARROW_DOWN": case "TEXT": case "TREND_LINE": return drawing.style.color;
    case "RECTANGLE": return drawing.style.fillColor;
    case "AB_CD": case "FIB_RETRACEMENT": return drawing.style.singleColor ?? drawing.style.levels.find(level => level.enabled)?.color;
  }
}
export function drawingSettingsLabel(drawing: MarketDrawing) {
  switch (drawing.type) {
    case "AB_CD": return copy.marketReplay.abcdSettings;
    case "ARROW_UP": return copy.marketReplay.arrowUpSettings;
    case "ARROW_DOWN": return copy.marketReplay.arrowDownSettings;
    case "TEXT": return copy.marketReplay.textSettings;
    case "RECTANGLE": return copy.marketReplay.rectangleSettings;
    case "TREND_LINE": return copy.marketReplay.trendLineSettings;
    case "FIB_RETRACEMENT": return copy.marketReplay.fibonacciSettings;
  }
}
export function drawingDeleteLabel(drawing: MarketDrawing) {
  switch (drawing.type) {
    case "AB_CD": return copy.marketReplay.abcdDelete;
    case "ARROW_UP": return copy.marketReplay.arrowUpDelete;
    case "ARROW_DOWN": return copy.marketReplay.arrowDownDelete;
    case "TEXT": return copy.marketReplay.textDelete;
    case "RECTANGLE": return copy.marketReplay.rectangleDelete;
    case "TREND_LINE": return copy.marketReplay.trendLineDelete;
    case "FIB_RETRACEMENT": return copy.marketReplay.fibonacciDelete;
  }
}
