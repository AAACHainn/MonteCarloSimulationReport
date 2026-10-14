import { describe, expect, it } from "vitest";
import { replayJournalLinkTarget, replayJournalTradeHref } from "./journal-links";

describe("journal links independent of display numbering", () => {
  it("links to an unrecycled internal number and encodes the parent identities", () => {
    expect(replayJournalTradeHref("market id", "journal/id", 91)).toBe("/market-replay/market%20id/history/journal%2Fid?journalNo=91");
    expect(replayJournalLinkTarget({ journalNo: "91" })).toEqual({ no: 91 });
  });
  it("keeps old numeric bookmarks bound to their original stored account number", () => {
    expect(replayJournalLinkTarget({ trade: "6" })).toEqual({ accountNo: 6 });
    expect(replayJournalLinkTarget({ journalNo: "91", trade: "1" })).toEqual({ no: 91 });
  });
  it.each(["", "0", "-1", "1.2", "abc", "9007199254740992"])("rejects invalid requested identities (%s) without falling back to another trade", (journalNo) => {
    expect(replayJournalLinkTarget({ journalNo, trade: "1" })).toBeNull();
  });
});
