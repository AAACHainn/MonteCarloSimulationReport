import { copy } from "@/lib/i18n";
import type { PdfWindow } from "@/lib/paper-trading/pdf-types";
import { aggregateHasGap, aggregatePhase } from "./bar-quality";

export function chartSnapshotCaption(window: Pick<PdfWindow, "bars">) {
  if (window.bars.some(bar => aggregateHasGap(bar) || aggregatePhase(bar) === "FORMING")) return copy.paperTrading.pdf.incomplete;
  return window.bars.some(bar => bar.quality === "UNKNOWN")
    ? `${copy.paperTrading.pdf.chartLegend} ${copy.marketReplay.barEmission.unknownCoverage}`
    : copy.paperTrading.pdf.chartLegend;
}
