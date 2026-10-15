/** IDs may already contain literal percent escapes from deterministic fill IDs. */
export function replayJournalEntryApiHref(datasetId: string, entryId: string) {
  return `/api/market-datasets/${encodeURIComponent(datasetId)}/paper-journal/entries/${encodeURIComponent(entryId)}`;
}

/** Links use the unrecycled internal number, independently of the visible ordinal. */
export function replayJournalTradeHref(datasetId: string, journalSessionId: string, globalNo: number) {
  return `/market-replay/${encodeURIComponent(datasetId)}/history/${encodeURIComponent(journalSessionId)}?journalNo=${globalNo}`;
}

export function replayJournalLinkTarget(query: { journalNo?: string; trade?: string }): { no: number } | { accountNo: number } | null {
  const stable = query.journalNo !== undefined;
  const value = Number(stable ? query.journalNo : query.trade);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  // Old bookmarks keep looking up the original stored number, never a new display ordinal.
  return stable ? { no: value } : { accountNo: value };
}
