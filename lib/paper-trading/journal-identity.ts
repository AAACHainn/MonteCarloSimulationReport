/** Engine identities, shared by creation and evidence association; no fee allocation is implied. */
export const entryLotId = (fillId: string) => `lot_${fillId}`;
export const fifoRowId = (fillId: string, lotId: string, index: number) => `journal_${fillId}_${lotId}_${index}`;
export function isFifoRowExit(rowId: string, fillId: string, lotId: string) {
  const prefix = fifoRowId(fillId, lotId, 0).slice(0, -1);
  return rowId.startsWith(prefix) && /^\d+$/.test(rowId.slice(prefix.length));
}
