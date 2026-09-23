import { describe, expect, it } from "vitest";
import { replayJournalExcelFilename } from "./journal-excel";

describe("replay journal Excel filename", () => {
  it("removes Windows-invalid characters and keeps the xlsx extension", () => {
    expect(replayJournalExcelFilename(" 上午/突破:*练习? ", "session-1"))
      .toBe("回放交易日志-上午-突破--练习-.xlsx");
  });

  it("falls back to the session id when the name has no usable characters", () => {
    expect(replayJournalExcelFilename("...", "session-1"))
      .toBe("回放交易日志-session-1.xlsx");
  });
});
