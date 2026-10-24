import { describe, expect, it } from "vitest";
import { createReplayJournalExcel, replayJournalExcelFilename } from "./journal-excel";
import JSZip from "jszip";
import { pdfEntry } from "./pdf-test-fixtures";
import { journalFieldValue } from "./journal-columns";

describe("replay journal Excel filename", () => {
  it("identifies prop rounds in exports while preserving ordinary account columns", async () => {
    const entry = pdfEntry(1, 0, 1, { propRoundNumber: 2 });
    const prop = await JSZip.loadAsync(await createReplayJournalExcel([entry]));
    const ordinary = await JSZip.loadAsync(await createReplayJournalExcel([pdfEntry(1, 0, 1)]));
    const propSheet = await prop.file("xl/worksheets/sheet1.xml")!.async("string");
    const ordinarySheet = await ordinary.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(propSheet).toContain("账户轮次"); expect(ordinarySheet).not.toContain("账户轮次");
    expect(propSheet).toContain('<c r="B2" s="5"><v>2</v></c>');
    expect(journalFieldValue(entry, "no")).toBe("1 · 第 2 轮");
    expect(journalFieldValue(pdfEntry(1, 0, 1), "no")).toBe("1");
  });
  it("removes Windows-invalid characters and keeps the xlsx extension", () => {
    expect(replayJournalExcelFilename(" 上午/突破:*练习? ", "session-1"))
      .toBe("回放交易日志-上午-突破--练习-.xlsx");
  });

  it("falls back to the session id when the name has no usable characters", () => {
    expect(replayJournalExcelFilename("...", "session-1"))
      .toBe("回放交易日志-session-1.xlsx");
  });
});
