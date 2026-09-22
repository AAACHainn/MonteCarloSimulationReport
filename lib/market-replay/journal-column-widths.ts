export const MIN_JOURNAL_COLUMN_WIDTH = 64;
export const MAX_JOURNAL_COLUMN_WIDTH = 640;

export function clampJournalColumnWidth(width: number) {
  return Math.min(MAX_JOURNAL_COLUMN_WIDTH, Math.max(MIN_JOURNAL_COLUMN_WIDTH, Math.round(width)));
}

export function normalizeJournalTableWidth(width: number) {
  return Math.max(0, Math.round(width));
}

export function normalizeJournalTableOffset(offset: number) {
  return Math.round(offset);
}

export function parseStoredJournalTableWidth(storedValue: string | null) {
  if (!storedValue) return null;
  const parsed = Number(storedValue);
  return Number.isFinite(parsed) && parsed > 0 ? normalizeJournalTableWidth(parsed) : null;
}

export function parseStoredJournalTableOffset(storedValue: string | null) {
  if (!storedValue) return 0;
  const parsed = Number(storedValue);
  return Number.isFinite(parsed) ? normalizeJournalTableOffset(parsed) : 0;
}

export function resizeJournalTableFromStartEdge({
  startWidth,
  startOffset,
  pointerDelta,
  minimumWidth,
}: {
  startWidth: number;
  startOffset: number;
  pointerDelta: number;
  minimumWidth: number;
}) {
  const width = Math.max(
    normalizeJournalTableWidth(minimumWidth),
    normalizeJournalTableWidth(startWidth - pointerDelta),
  );

  return {
    width,
    offset: normalizeJournalTableOffset(startOffset + startWidth - width),
  };
}

export function parseStoredJournalColumnWidths<ColumnId extends string>(
  storedValue: string | null,
  defaultWidths: Record<ColumnId, number>,
) {
  if (!storedValue) return defaultWidths;

  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultWidths;

    const widths = { ...defaultWidths };
    for (const columnId of Object.keys(defaultWidths) as ColumnId[]) {
      const value = (parsed as Record<string, unknown>)[columnId];
      if (typeof value === "number" && Number.isFinite(value)) {
        widths[columnId] = clampJournalColumnWidth(value);
      }
    }
    return widths;
  } catch {
    return defaultWidths;
  }
}
