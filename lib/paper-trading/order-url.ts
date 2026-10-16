export function paperOrderUrl(datasetId: string, orderId: string) {
  // Generated protective ids contain literal percent escapes; preserve them through route decoding.
  return `/api/market-datasets/${encodeURIComponent(datasetId)}/paper-session/orders/${encodeURIComponent(orderId)}`;
}
