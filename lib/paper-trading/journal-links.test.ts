import { describe, expect, it } from "vitest";
import { replayJournalEntryApiHref, replayJournalLinkTarget, replayJournalTradeHref } from "./journal-links";
import { createDeterministicEventIdFactory } from "./deterministic-id";
import { projectionRecordId } from "@/lib/replay-sessions/identity";

describe("journal annotation request URLs", () => {
  it("preserves literal escapes in real deterministic journal identities through one route decode", () => {
    const makeId = createDeterministicEventIdFactory("account", 1, 20347);
    const fillId = makeId("fill:order-1");
    const id = projectionRecordId("current", `journal_${fillId}_lot_${makeId("fill:entry-1")}_0`);
    expect(id).toContain("%3A");
    const rawPath = new URL(`/api/market-datasets/market/paper-journal/entries/${id}`, "http://localhost");
    expect(decodeURIComponent(rawPath.pathname.split("/").at(-1)!)).not.toBe(id);
    const url = new URL(replayJournalEntryApiHref("market", id), "http://localhost");
    expect(url.pathname).toContain("%253A");
    expect(decodeURIComponent(url.pathname.split("/").at(-1)!)).toBe(id);
  });

  it.each(["entry-1", "projection::p::fill%3Aorder%253Aparent", "entry/with?reserved#characters", "复盘记录 100%"])("keeps each identifier in one path segment (%s)", (id) => {
    const url = new URL(replayJournalEntryApiHref("market/id", id), "http://localhost");
    const parts = url.pathname.split("/");
    expect(parts).toHaveLength(7);
    expect(decodeURIComponent(parts[3])).toBe("market/id");
    expect(decodeURIComponent(parts[6])).toBe(id);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });
});

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
