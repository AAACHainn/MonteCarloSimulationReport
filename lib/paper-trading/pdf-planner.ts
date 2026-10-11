import { copy } from "@/lib/i18n";
import { PDF_MAX_BARS, PDF_CHARTS_PER_VOLUME, type PdfChartPage, type PdfWindow } from "./pdf-types";
import type { ReplayJournalEntryData } from "./types";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

export type PdfWindowReader = (anchor: number, direction: "forward" | "backward", count: number, warmup?: number) => Promise<PdfWindow>;
function indexFor(bars: AggregatedMarketBarData[], sequence: number) {
  return bars.findIndex((b) => b.firstSequence <= sequence && b.lastSequence >= sequence);
}
export function pdfVolumeCount(chartCount: number) { return Math.ceil(chartCount / PDF_CHARTS_PER_VOLUME); }
function descriptor(bars: AggregatedMarketBarData[], entries: ReplayJournalEntryData[], beforeCount: number, afterCount: number): PdfChartPage {
  if (!bars.length || bars.length > PDF_MAX_BARS) throw new Error(copy.paperTrading.pdf.missingBars);
  return { fromSequence: bars[0].firstSequence, toSequence: bars.at(-1)!.lastSequence, count: bars.length, entryIds: entries.map((e) => e.id), beforeCount, afterCount, part: 1, parts: 1 };
}

/** Retain only a bounded working window and small page descriptors, never a full series. */
export async function planPdfCharts(entries: ReplayJournalEntryData[], read: PdfWindowReader, onPage: (count: number) => void = () => {}) {
  const ordered = [...entries].sort((a, b) => a.openedSequence - b.openedSequence || a.no - b.no);
  const pages: PdfChartPage[] = [];
  for (let i = 0; i < ordered.length;) {
    const entry = ordered[i];
    const left = (await read(entry.openedSequence, "backward", 51)).bars.filter((b) => b.lastSequence < entry.openedSequence);
    let forward = await read(entry.openedSequence, "forward", PDF_MAX_BARS);
    if (indexFor(forward.bars, entry.openedSequence) < 0) throw new Error(copy.paperTrading.pdf.missingBars);
    let closeIndex = indexFor(forward.bars, entry.closedSequence);
    if (closeIndex >= 0) {
      const group = [entry];
      let next = i + 1;
      while (next < ordered.length && group.length < 6) {
        const candidate = ordered[next];
        const candidateOpen = indexFor(forward.bars, candidate.openedSequence);
        const candidateClose = indexFor(forward.bars, candidate.closedSequence);
        const end = Math.max(closeIndex, candidateClose);
        if (candidateOpen < 0 || candidateClose < 0 || end + 1 + Math.min(50, left.length) + 20 > PDF_MAX_BARS) break;
        closeIndex = end; group.push(candidate); next++;
      }
      const coreCount = closeIndex + 1;
      const after = Math.min(20, PDF_MAX_BARS - coreCount, forward.bars.length - coreCount);
      const before = Math.min(50, left.length, PDF_MAX_BARS - coreCount - after);
      pages.push(descriptor([...left.slice(left.length - before), ...forward.bars.slice(0, coreCount + after)], group, before, after));
      onPage(pages.length); i = next; continue;
    }
    const startPart = pages.length;
    let prefix = left.slice(-50);
    while (true) {
      const room = PDF_MAX_BARS - prefix.length;
      const usable = forward.bars.slice(0, room);
      closeIndex = indexFor(usable, entry.closedSequence);
      if (closeIndex >= 0) {
        const after = Math.min(20, room - closeIndex - 1, usable.length - closeIndex - 1);
        pages.push(descriptor([...prefix, ...usable.slice(0, closeIndex + 1 + after)], [entry], pages.length === startPart ? prefix.length : 0, after));
        onPage(pages.length); break;
      }
      const bars = [...prefix, ...usable];
      if (bars.length < PDF_MAX_BARS || forward.nextSequence === null) throw new Error(copy.paperTrading.pdf.missingBars);
      pages.push(descriptor(bars, [entry], pages.length === startPart ? prefix.length : 0, 0));
      onPage(pages.length);
      const anchor = bars[bars.length - 20].firstSequence;
      if (anchor <= forward.bars[0].firstSequence) throw new Error(copy.paperTrading.pdf.missingBars);
      prefix = [];
      forward = await read(anchor, "forward", PDF_MAX_BARS);
    }
    const parts = pages.length - startPart;
    for (let n = startPart; n < pages.length; n++) { pages[n].part = n - startPart + 1; pages[n].parts = parts; }
    i++;
  }
  return pages;
}
