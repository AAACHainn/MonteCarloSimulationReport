import JSZip from "jszip";
import { copy } from "@/lib/i18n";
import { utcDateParts } from "@/lib/market-replay/display-timezone";
import type { ReplayJournalEntryData } from "./types";

type CellValue = string | number | null;

type ExportColumn = {
  header: string;
  width: number;
  style: "text" | "date" | "number" | "ratio" | "integer";
  value: (entry: ReplayJournalEntryData) => CellValue;
};

const columns: ExportColumn[] = [
  { header: "No", width: 10, style: "integer", value: (entry) => entry.no },
  { header: "Date", width: 14, style: "date", value: (entry) => excelDate(entry) },
  { header: "Direction", width: 12, style: "text", value: (entry) => entry.direction === "LONG" ? copy.paperTrading.long : copy.paperTrading.short },
  { header: copy.paperTrading.setup, width: 28, style: "text", value: (entry) => entry.setupOption?.name ?? "" },
  { header: copy.paperTrading.tradeReason, width: 36, style: "text", value: (entry) => entry.tradeReasons.map((reason) => reason.name).join("、") },
  { header: "ABR", width: 14, style: "number", value: (entry) => entry.abrValue },
  { header: "iRisk", width: 14, style: "number", value: (entry) => entry.initialRisk },
  { header: "iRisk / ABR", width: 16, style: "ratio", value: (entry) => entry.initialRiskAbr },
  { header: "aRisk", width: 14, style: "number", value: (entry) => entry.actualRisk },
  { header: "aRisk / ABR", width: 16, style: "ratio", value: (entry) => entry.actualRiskAbr },
  { header: "aRisk / iRisk", width: 16, style: "ratio", value: (entry) => entry.actualInitialRiskRatio },
  { header: "Gain / Loss", width: 16, style: "number", value: (entry) => entry.gainLoss },
  { header: "Result", width: 12, style: "text", value: (entry) => entry.result },
  { header: "ABR RR", width: 14, style: "ratio", value: (entry) => entry.abrRr },
  { header: "iRisk RR", width: 14, style: "ratio", value: (entry) => entry.initialRiskRr },
  { header: "aRisk RR", width: 14, style: "ratio", value: (entry) => entry.actualRiskRr },
];

const styleIndexes = {
  text: 0,
  date: 2,
  number: 3,
  ratio: 4,
  integer: 5,
} as const;

export async function createReplayJournalExcel(entries: ReplayJournalEntryData[]) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("_rels/.rels", packageRelationshipsXml);
  zip.file("docProps/app.xml", appPropertiesXml);
  zip.file("docProps/core.xml", corePropertiesXml);
  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", workbookRelationshipsXml);
  zip.file("xl/styles.xml", stylesXml);
  zip.file("xl/worksheets/sheet1.xml", worksheetXml(entries));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export function replayJournalExcelFilename(sessionName: string, sessionId: string) {
  const sanitized = sessionName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return `回放交易日志-${sanitized || sessionId}.xlsx`;
}

function excelDate(entry: ReplayJournalEntryData) {
  const parts = utcDateParts(entry.openedAt, entry.displayUtcOffsetMinutes);
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000 + 25_569;
}

function worksheetXml(entries: ReplayJournalEntryData[]) {
  const lastRow = entries.length + 1;
  const lastColumn = columnName(columns.length);
  const columnDefinitions = columns.map((column, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`
  )).join("");
  const header = columns.map((column, index) => stringCell(columnName(index + 1), 1, column.header, 1)).join("");
  const rows = entries.map((entry, rowIndex) => {
    const row = rowIndex + 2;
    const cells = columns.map((column, columnIndex) => {
      const reference = columnName(columnIndex + 1);
      const value = column.value(entry);
      return typeof value === "number"
        ? numberCell(reference, row, value, styleIndexes[column.style])
        : stringCell(reference, row, value ?? "", styleIndexes[column.style]);
    }).join("");
    return `<row r="${row}">${cells}</row>`;
  }).join("");

  return xml(`
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columnDefinitions}</cols>
  <sheetData><row r="1" ht="24" customHeight="1">${header}</row>${rows}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`);
}

function stringCell(column: string, row: number, value: string, style: number) {
  const preserveWhitespace = /^\s|\s$/.test(value) ? " xml:space=\"preserve\"" : "";
  return `<c r="${column}${row}" s="${style}" t="inlineStr"><is><t${preserveWhitespace}>${escapeXml(value)}</t></is></c>`;
}

function numberCell(column: string, row: number, value: number, style: number) {
  if (!Number.isFinite(value)) return `<c r="${column}${row}" s="${style}"/>`;
  return `<c r="${column}${row}" s="${style}"><v>${value}</v></c>`;
}

function columnName(index: number) {
  let value = index;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + value % 26) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function escapeXml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body.trim()}`;
}

const contentTypesXml = xml(`
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);

const packageRelationshipsXml = xml(`
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);

const appPropertiesXml = xml(`
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>交易系统分析台</Application>
</Properties>`);

const corePropertiesXml = xml(`
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>回放交易日志</dc:title>
  <dc:creator>交易系统分析台</dc:creator>
</cp:coreProperties>`);

const workbookXml = xml(`
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews>
  <sheets><sheet name="交易记录" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);

const workbookRelationshipsXml = xml(`
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

const stylesXml = xml(`
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
    <numFmt numFmtId="165" formatCode="0.########"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
