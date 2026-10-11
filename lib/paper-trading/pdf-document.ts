import { encodePdfText } from "./pdf-text";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { copy } from "@/lib/i18n";
import { formatNumber, formatPercent } from "@/lib/format";
import { formatPriceForTick } from "@/lib/market-replay/price-ticks";
import { formatInterval } from "@/lib/market-replay/types";
import { formatUtcDateTime, formatUtcOffset } from "@/lib/market-replay/display-timezone";
import { journalColumns, journalFieldValue, type JournalColumnId } from "./journal-columns";
import type { PdfChartPage, PdfVolumeMetadata } from "./pdf-types";

const text = copy.paperTrading.pdf;
const fontName = "NotoSansSC";
export function selectedDetailColumns(ids: JournalColumnId[]) {
  return journalColumns.filter((c) => c.id === "no" || ids.includes(c.id));
}
function binaryFont(bytes: Uint8Array) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return value;
}
export class ReplayPdfDocument {
  private readonly doc: jsPDF;
  private charts = 0;
  private escapedCharacters = false;
  constructor(private readonly metadata: PdfVolumeMetadata, font: ArrayBuffer) {
    this.doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
    this.doc.addFileToVFS("NotoSansSC-Regular.ttf", binaryFont(new Uint8Array(font)));
    this.doc.addFont("NotoSansSC-Regular.ttf", fontName, "normal");
    this.doc.setFont(fontName, "normal");
    this.doc.setProperties({ title: `${text.reportTitle} - ${metadata.snapshot.session.name}`, author: copy.nav.brand });
    const ids = new Set(metadata.pages.flatMap((p) => p.entryIds));
    this.encode(metadata.snapshot.session.name); this.encode(metadata.snapshot.dataset.symbol); this.encode(metadata.snapshot.filterDescription);
    if (metadata.options.includeDetails) for (const e of metadata.snapshot.entries.filter((e) => ids.has(e.id)))
      for (const c of selectedDetailColumns(metadata.options.detailFieldIds)) this.encode(journalFieldValue(e, c.id));
    this.overview();
  }
  private encode(value: string) {
    const font = this.doc.getFont().metadata as unknown as { characterToGlyph: (code: number) => number };
    const result = encodePdfText(value, (code) => font.characterToGlyph(code) > 0);
    this.escapedCharacters ||= result.escaped;
    return result.text;
  }
  private heading(title: string) {
    this.doc.setTextColor(15, 23, 42); this.doc.setFontSize(17); this.doc.text(this.encode(title), 12, 15);
  }
  private table(head: string[], body: string[][], y: number, columnStyles = {}) {
    autoTable(this.doc, {
      startY: y, margin: { top: 25, left: 12, right: 12, bottom: 14 }, head: [head.map((value) => this.encode(value))], body: body.map((row) => row.map((value) => this.encode(value))),
      styles: { font: fontName, fontStyle: "normal", fontSize: 10, cellPadding: 2, overflow: "linebreak", textColor: [15, 23, 42] },
      headStyles: { fontStyle: "normal", fillColor: [30, 58, 95], textColor: [255, 255, 255] }, alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles, rowPageBreak: "avoid", showHead: "everyPage", theme: "grid",
      willDrawCell: (data) => {
        if (head[0] === copy.paperTrading.journalFields.no && data.section === "body" && data.column.index === 0) data.cell.text = [String(data.cell.raw)];
      },
    });
  }
  private overview() {
    const { snapshot: s, options: o, preferences: p, volume, volumes } = this.metadata;
    this.heading(text.reportTitle);
    this.doc.setFontSize(11);
    this.doc.text(text.volume(volume, volumes), 240, 15);
    const settings = `${formatInterval(o.displayIntervalSeconds)} · ${o.displaySession} · ${formatUtcOffset(p.displayUtcOffsetMinutes)}`;
    this.table([s.dataset.symbol, s.session.name], [
      [text.snapshot, formatUtcDateTime(s.capturedAt, p.displayUtcOffsetMinutes)],
      [text.trades, text.counts(s.session.totalCount, s.entries.length)],
      [text.filters, s.filterDescription], [text.settings, settings],
      [copy.paperTrading.journalWinRate, formatPercent(s.summary.winRate)],
      [copy.paperTrading.totalProfitPoints, formatNumber(s.summary.totalProfitPoints)],
      [copy.paperTrading.totalLossPoints, formatNumber(s.summary.totalLossPoints)],
      [copy.paperTrading.actualProfitLossRatio, s.summary.actualProfitLossRatio === null ? copy.common.dash : formatNumber(s.summary.actualProfitLossRatio)],
      [text.includeDetails, o.includeDetails ? selectedDetailColumns(o.detailFieldIds).map((c) => c.label).join(" · ") : text.detailsOff],
      [text.reportTitle, text.snapshotHint + " " + text.context + (this.escapedCharacters ? " " + text.unicodeHint : "")],
    ], 26, { 0: { cellWidth: 45 } });
  }
  addChart(page: PdfChartPage, png: ArrayBuffer, caption: string) {
    const m = this.metadata;
    this.doc.addPage(); this.charts++;
    this.heading(`${m.snapshot.dataset.symbol} · ${text.chartCaption(m.chartOffset + this.charts, m.totalCharts)}`);
    this.doc.setFontSize(9);
    this.doc.text(`${formatInterval(m.options.displayIntervalSeconds)} · ${m.options.displaySession} · ${formatUtcOffset(m.preferences.displayUtcOffsetMinutes)} · ${caption}`, 12, 23);
    this.doc.addImage(new Uint8Array(png), "PNG", 12, 28, 273, 136.5, undefined, "FAST");
    this.doc.setFontSize(9);
    this.doc.text(text.contextCounts(page.beforeCount, page.afterCount) + (page.parts > 1 ? " · " + text.continuation(page.part, page.parts) : ""), 12, 170);
    const ids = new Set(page.entryIds);
    const entries = m.snapshot.entries.filter((e) => ids.has(e.id));
    entries.forEach((e, i) => {
      const side = e.direction === "LONG" ? copy.paperTrading.long : copy.paperTrading.short;
      const row = `#${e.no} · ${side} · ${text.entry} ${formatPriceForTick(e.entryPrice, e.priceTickSize)} · ${text.exit} ${formatPriceForTick(e.exitPrice, e.priceTickSize)} · ${text.quantity} ${e.quantity.toLocaleString("zh-CN", { maximumSignificantDigits: 15 })} · ${e.result} · ${text.original(formatInterval(e.displayIntervalSeconds), e.displaySession)} · ${formatUtcOffset(e.displayUtcOffsetMinutes)}`;
      this.doc.text(this.encode(row), 12, 175 + i * 4);
    });
  }
  finish(): ArrayBuffer {
    if (this.metadata.options.includeDetails) {
      const ids = new Set(this.metadata.pages.flatMap((p) => p.entryIds));
      const entries = this.metadata.snapshot.entries.filter((e) => ids.has(e.id));
      const selected = selectedDetailColumns(this.metadata.options.detailFieldIds).filter((c) => c.id !== "no");
      const groups: (typeof journalColumns)[] = [];
      let current: typeof journalColumns = [];
      for (const c of selected) {
        if (c.id === "review" || c.id === "reason") {
          if (current.length) groups.push(current);
          current = []; groups.push([c]);
        } else {
          current.push(c);
          if (current.length === 4) { groups.push(current); current = []; }
        }
      }
      if (current.length) groups.push(current);
      if (!groups.length) groups.push([]);
      for (const group of groups) {
        this.doc.addPage(); this.heading(text.details);
        const fields = [journalColumns[0], ...group];
        this.table(fields.map((c) => c.label), entries.map((e) => fields.map((c) => journalFieldValue(e, c.id))), 26, { 0: { cellWidth: 18 } });
      }
    }
    const count = this.doc.getNumberOfPages();
    for (let i = 1; i <= count; i++) {
      this.doc.setPage(i); this.doc.setFontSize(9); this.doc.setTextColor(100, 116, 139);
      this.doc.text(text.volume(this.metadata.volume, this.metadata.volumes), 12, 204);
      this.doc.text(text.page(i, count), 250, 204);
    }
    return this.doc.output("arraybuffer");
  }
}
