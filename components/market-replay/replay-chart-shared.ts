import { type Ref } from "react";
import type { AbcdGeometry, ArrowDrawingType } from "@/lib/market-replay/chart-drawings";
import type { ReplayViewportApi, ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";
import type { OrderSubmitResult } from "@/lib/paper-trading/types";
import type { AggregatedMarketBarData, BarCountIndicatorConfig, DisplaySession, EmaIndicatorConfig, TradingSessionConfig } from "@/lib/market-replay/types";
import { copy } from "@/lib/i18n";
import { type CandlestickStyle } from "@/lib/market-replay/candlestick-style";
import { type ChartMeasurementStats } from "@/lib/market-replay/chart-measurement";
import { type DrawingGeometry, type TwoPointDrawingTool, type RectangleStyle, type DrawingAnchor, type DrawingTool, type FibonacciRetracementStyle, type MarketDrawing, type TrendLineDrawing, type TrendLineGeometry } from "@/lib/market-replay/chart-drawings";
import { type TextDrawingApi } from "@/lib/market-replay/text-drawing-primitive";
import { formatPriceForTick, priceDecimalsForTick } from "@/lib/market-replay/price-ticks";
import { type RiskSizingError } from "@/lib/paper-trading/risk-sizing";
import { formatRMultiple, priceDifferenceFromEntry, rMultipleAtPrice, type PriceRReference } from "@/lib/paper-trading/line-r-multiple";
import type { PaperSessionSnapshot, PaperSide, ReplayTradeAnnotationData } from "@/lib/paper-trading/types";
import { type ChartRewindRange, type ChartRewindTarget } from "@/lib/market-replay/chart-rewind";
import { type ChartHideAfter } from "@/lib/market-replay/chart-hide-after";

export type DraftOrder = {
  id: string;
  side: PaperSide;
  type: "LIMIT" | "STOP";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  targetR: number;
  tpMode: "LINKED" | "FREE";
};

export type ContextMenuState = { x: number; y: number; price: number; rewindTarget: ChartRewindTarget | null; hideAfter: ChartHideAfter | null };
export type AbrTooltipState = {
  left: number;
  top: number;
  bar: AggregatedMarketBarData;
  value: number | null;
};
export type OrderUpdate = {
  price?: number;
  quantity?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskAmount?: number | null;
};
export type LineTarget = {
  key: string;
  price: number;
  kind: "draft" | "order";
  field: "entryPrice" | "stopLoss" | "takeProfit" | "price";
  orderId?: string;
  rReference?: PriceRReference;
};
export type LineAction = {
  key: string;
  price: number;
  y: number;
  color: string;
  label: string;
  kind: "cancel" | "close";
  orderId?: string;
};
export type MeasurementPoint = {
  index: number;
  timestamp: string | null;
  price: number;
  x: number;
  y: number;
};
export type MeasurementState = {
  phase: "tracking" | "fixed";
  start: MeasurementPoint;
  end: MeasurementPoint;
  paneWidth: number;
  paneHeight: number;
  stats: ChartMeasurementStats;
};
export type DrawingDraft = {
  start: DrawingAnchor;
  end: DrawingAnchor;
};
export type DrawingSegmentCoordinate = {
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type ReplayVisibleSequenceRange = {
  fromSequence: number;
  toSequence: number;
  barsBefore: number;
  barsAfter: number;
};

export function sameLineActions(current: LineAction[], next: LineAction[]) {
  return current.length === next.length && current.every((action, index) => {
    const candidate = next[index];
    return action.key === candidate.key
      && action.price === candidate.price
      && action.y === candidate.y
      && action.color === candidate.color
      && action.label === candidate.label
      && action.kind === candidate.kind
      && action.orderId === candidate.orderId;
  });
}

export function abrValueAt(
  warmupBars: AggregatedMarketBarData[],
  bars: AggregatedMarketBarData[],
  visibleIndex: number,
  length: number,
) {
  const end = warmupBars.length + visibleIndex;
  if (end < length - 1) return null;
  let sum = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const index = end - offset;
    const bar = index < warmupBars.length ? warmupBars[index] : bars[index - warmupBars.length];
    sum += Math.abs(bar.high - bar.low);
  }
  return sum / length;
}

export function number(value: number, digits = 8) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

export function money(value: number, currency: string) {
  return `${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
}

export function compactVolume(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAbrValue(value: number | null, priceTickSize: number) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: Math.min(12, Math.max(2, priceDecimalsForTick(priceTickSize) + 2)),
  }).format(value);
}

export function sizingErrorText(error: RiskSizingError) {
  const labels: Record<RiskSizingError, string> = {
    INVALID_PRICE: copy.paperTrading.invalidPrice,
    INVALID_RISK_AMOUNT: copy.paperTrading.invalidRiskAmount,
    INVALID_STOP_SIDE: copy.paperTrading.invalidStopSide,
    INVALID_TARGET_SIDE: copy.paperTrading.invalidTargetSide,
    INVALID_UNIT_RISK: copy.paperTrading.invalidUnitRisk,
    QUANTITY_LIMIT: copy.paperTrading.quantityLimit,
  };
  return labels[error];
}

export function orderTypeLabel(type: "LIMIT" | "STOP") {
  return type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop;
}

export function bracketPriceLineTitle(reference: PriceRReference | null, price: number, priceTickSize: number) {
  const ratio = formatRMultiple(rMultipleAtPrice(reference, price));
  const difference = priceDifferenceFromEntry(reference, price);
  return difference === null
    ? ratio
    : copy.paperTrading.priceLineRiskAndDifference(ratio, formatPriceForTick(difference, priceTickSize));
}


export type ReplayChartProps = {
  cursorMode?: import("@/lib/market-replay/cursor-mode").ReplayCursorMode;
  datasetId: string;
  dataRevision?: string;
  priceTickSize: number;
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  displayUtcOffsetMinutes: number;
  displayIntervalSeconds: number;
  sourceIntervalSeconds?: number;
  candleCountdownEnabled?: boolean;
  playbackActive?: boolean;
  currentSourceTimestamp?: string | null;
  currentSourceSequence?: number;
  liveWindow?: boolean;
  viewportApiRef?: Ref<ReplayViewportApi>;
  viewportSnapshot?: ReplayViewportSnapshot | null;
  measurementArmed: boolean;
  candlestickStyle: CandlestickStyle;
  onMeasurementArmedChange: (armed: boolean) => void;
  rectangleDraftStyle: RectangleStyle;
  drawingTool: DrawingTool | null;
  onDrawingToolChange: (tool: DrawingTool | null) => void;
  trendLineDraftStyle: TrendLineDrawing["style"];
  fibonacciDraftStyle: FibonacciRetracementStyle;
  abcdDraftStyle?: FibonacciRetracementStyle;
  drawings: MarketDrawing[];
  selectedDrawingId: string | null;
  onSelectedDrawingIdChange: (id: string | null) => void;
  onCreateDrawing: (type: TwoPointDrawingTool, geometry: TrendLineGeometry) => void;
  onUpdateDrawing: (id: string, geometry: DrawingGeometry) => void;
  onPlaceText?: (anchor: DrawingAnchor) => void;
  onPlaceArrow?: (type: ArrowDrawingType, anchor: DrawingAnchor) => void;
  onCreateAbcd?: (geometry: AbcdGeometry) => void;
  drawingApiRef?: Ref<TextDrawingApi>;
  onDeleteDrawing: (id: string) => void;
  onOpenDrawingStyle: (id: string, inlineText?: boolean) => void;
  emaEnabled: boolean;
  emaIndicators: EmaIndicatorConfig[];
  abrEnabled: boolean;
  abrLength: number;
  volumeVisible: boolean;
  gridVisible?: boolean;
  onToggleGrid?: () => void;
  displaySession: DisplaySession;
  barCountSession: TradingSessionConfig;
  barCountConfig: BarCountIndicatorConfig;
  paperSnapshot: PaperSessionSnapshot | null;
  tradeAnnotations: ReplayTradeAnnotationData[];
  tradeAnnotationsTruncated: boolean;
  tradeAnnotationsVisible?: boolean;
  focusSequence?: number | null;
  onFocusApplied?: () => void;
  readOnly?: boolean;
  paperBusy: boolean;
  paperError: string | null;
  onSubmitOrder: (order: { side: PaperSide; type: "LIMIT" | "STOP"; quantity: number; riskAmount: number; price: number; stopLoss: number; takeProfit: number }, draftId?: string) => Promise<boolean | OrderSubmitResult>;
  onOrderPriceChange: (orderId: string, update: OrderUpdate) => Promise<boolean>;
  onCancelOrder: (orderId: string) => Promise<boolean>;
  onClosePosition: () => Promise<boolean>;
  onDraftActiveChange: (active: boolean) => void;
  onDraftIdentityChange?: (draftId: string | null) => void;
  entryCheckOpen?: boolean;
  onOpenPaperAccount: () => void;
  onVisibleSequenceRangeChange?: (range: ReplayVisibleSequenceRange) => void;
  onRewindToBar?: (target: ChartRewindTarget) => void;
  rewindRange?: ChartRewindRange;
};
