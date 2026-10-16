import { copy } from "@/lib/i18n";
import type { PdfWindow } from "@/lib/paper-trading/pdf-types";

export const chartSnapshotCaption = (window: Pick<PdfWindow, "bars">) => window.bars.some((bar) => bar.status !== "COMPLETE")
  ? copy.paperTrading.pdf.incomplete : copy.paperTrading.pdf.chartLegend;
