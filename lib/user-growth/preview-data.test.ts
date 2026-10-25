import { describe, expect, it } from "vitest";
import { makePreviewProfile, makePreviewRecordPage, previewUsers } from "./preview-data";

describe("preview history paging", () => {
  it("generates a bounded page from a 5,000-record archive", () => {
    const first = makePreviewRecordPage(8, 1);
    const second = makePreviewRecordPage(8, 2);
    expect(first.total).toBe(5000);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(20);
    expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(40);
    expect(first.items.at(-1)!.settledAt > second.items[0].settledAt).toBe(true);
    expect(makePreviewRecordPage(8, 2)).toEqual(second);
    expect(makePreviewProfile(previewUsers[0], 8).records).toHaveLength(5);
  });
  it("allows viewing the oldest records and clamps navigation to real pages", () => {
    const last = makePreviewRecordPage(8, 250);
    expect(last.page).toBe(250);
    expect(last.items).toHaveLength(20);
    expect(last.items.at(-1)!.id).toBe("record-4999");
    expect(makePreviewRecordPage(8, 251)).toEqual(last);
    expect(makePreviewRecordPage(8, -1).page).toBe(1);
  });
  it("preserves the archive across a breakthrough and exposes a partial last page", () => {
    const before = makePreviewRecordPage(8, 250);
    const first = makePreviewRecordPage(8, 1, true);
    const last = makePreviewRecordPage(8, 251, true);
    expect(first.total).toBe(5001);
    expect(first.items[0].id).toBe("breakthrough-demo");
    expect(last.items).toHaveLength(1);
    expect(last.items[0]).toEqual(before.items.at(-1));
  });
  it("returns an empty page for a new mortal and the full small archive otherwise", () => {
    expect(makePreviewRecordPage(0, 50)).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(makePreviewRecordPage(3, 1).items).toHaveLength(6);
    expect(makePreviewRecordPage(1, Number.NaN).items).toHaveLength(2);
  });
});
