export type BrowseDirection = -1 | 1;

export function getBrowsableTrades<T extends { screenshotPath: string | null }>(trades: T[]) {
  return trades.filter((trade) => Boolean(trade.screenshotPath));
}

export function resolveBrowseIndex<T extends { id: string }>(trades: T[], currentTradeId: string | null) {
  if (trades.length === 0) return -1;
  if (!currentTradeId) return 0;

  const currentIndex = trades.findIndex((trade) => trade.id === currentTradeId);
  return currentIndex >= 0 ? currentIndex : 0;
}

export function getAdjacentBrowseIndex(currentIndex: number, tradeCount: number, direction: BrowseDirection) {
  if (tradeCount <= 0) return -1;
  return Math.min(tradeCount - 1, Math.max(0, currentIndex + direction));
}
