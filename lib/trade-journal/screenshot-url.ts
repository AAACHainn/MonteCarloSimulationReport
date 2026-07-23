export function getTradeScreenshotUrl(
  journalId: string,
  tradeId: string,
  screenshotPath: string | null | undefined,
) {
  const baseUrl = `/api/trade-journals/${journalId}/trades/${tradeId}/screenshot`;
  return screenshotPath
    ? `${baseUrl}?version=${encodeURIComponent(screenshotPath)}`
    : baseUrl;
}
