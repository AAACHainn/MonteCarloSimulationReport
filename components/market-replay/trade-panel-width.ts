export const TRADE_PANEL_MIN_WIDTH = 320;
export const TRADE_PANEL_MAX_WIDTH = 640;
export const TRADE_PANEL_DEFAULT_WIDTH = 360;
export const TRADE_PANEL_WIDTH_KEY = "market-replay-trade-panel-width-v1";
const MIN_CHART_WIDTH = 480;
const DRAWING_TOOLBAR_WIDTH = 48;

export function tradePanelMaximum(workspaceWidth: number) {
  return Math.min(TRADE_PANEL_MAX_WIDTH, Math.max(TRADE_PANEL_MIN_WIDTH, workspaceWidth - MIN_CHART_WIDTH - DRAWING_TOOLBAR_WIDTH));
}

export function clampTradePanelWidth(width: number, maximum = TRADE_PANEL_MAX_WIDTH) {
  return Math.min(maximum, Math.max(TRADE_PANEL_MIN_WIDTH, width));
}

export function parseTradePanelWidth(value: string | null) {
  if (value === null || !value.trim()) return TRADE_PANEL_DEFAULT_WIDTH;
  const width = Number(value);
  return Number.isFinite(width) ? clampTradePanelWidth(width) : TRADE_PANEL_DEFAULT_WIDTH;
}
