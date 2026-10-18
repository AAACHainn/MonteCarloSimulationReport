import { describe, expect, it, vi } from "vitest";
import { planDisplayAdvance, DISPLAY_ADVANCE_PAGE_SIZE } from "./display-advance";
import { MAX_DISPLAY_ADVANCE_SOURCE_BARS } from "./types";
const session = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] };
function reader(count: number, seconds = 1, start = 0) {
  return vi.fn(async (after: number, take: number) => Array.from({ length: Math.min(take, count - after - 1) }, (_, i) => ({ sequence: after + i + 1, timestamp: new Date(start + (after + i + 1) * seconds * 1000) })));
}
describe("bounded display advance planning", () => {
  it("reads only a small candidate page and leaves look-ahead unrevealed", async () => {
    const read = reader(1000000);
    const result = await planDisplayAdvance({ currentSequence: -1, barCount: 1000000, sourceSeconds: 1, displaySeconds: 300, session, count: 1 }, read);
    expect(result).toMatchObject({ targetSequence: 299, reachedVisibleBucket: true });
    expect(read.mock.calls).toEqual([[-1,301]]);
  });
  it("pages long display buckets instead of materializing a full day", async () => {
    const read = reader(1000000);
    const result = await planDisplayAdvance({ currentSequence: -1, barCount: 1000000, sourceSeconds: 1, displaySeconds: 3600, session, count: 2 }, read);
    expect(result?.targetSequence).toBe(7199);
    expect(read.mock.calls).toHaveLength(2);
    expect(read.mock.calls.every(([,take]) => take <= DISPLAY_ADVANCE_PAGE_SIZE)).toBe(true);
  });
  it("keeps the source cap and returns a forming bucket for the next bounded call", async () => {
    const read = reader(200000);
    const result = await planDisplayAdvance({ currentSequence: 0, barCount: 200000, sourceSeconds: 1, displaySeconds: 86400, session, count: 2 }, read);
    expect(result).toMatchObject({ targetSequence: MAX_DISPLAY_ADVANCE_SOURCE_BARS, reachedVisibleBucket: false });
    expect(read.mock.calls.reduce((n,[,take]) => n + take,0)).toBe(MAX_DISPLAY_ADVANCE_SOURCE_BARS + 1);
  });
  it("crosses hidden RTH bars and stops before the second visible bucket", async () => {
    const read = reader(90000,60,Date.parse("2021-09-13T20:15:00Z"));
    const rth = { mode: "DAILY_SESSION" as const, timezone: "America/Chicago", openMinute: 510, closeMinute: 915, weekdays: [1,2,3,4,5] };
    const result = await planDisplayAdvance({ currentSequence: -1, barCount: 90000, sourceSeconds: 60, displaySeconds: 300, session: rth, count: 1 }, read);
    expect(result).toMatchObject({ targetSequence: 1039, reachedVisibleBucket: true, completedDisplayBucketStart: "2021-09-14T13:30:00.000Z" });
    expect(read.mock.calls.every(([,take]) => take <= DISPLAY_ADVANCE_PAGE_SIZE)).toBe(true);
    expect(read.mock.calls.reduce((n,[,take]) => n + take,0)).toBe(4160);
  });
  it("finishes at actual data end and handles an empty candidate range", async () => {
    const result = await planDisplayAdvance({ currentSequence: -1, barCount: 120, sourceSeconds: 1, displaySeconds: 300, session, count: 1 }, reader(120));
    expect(result).toMatchObject({ targetSequence: 119, reachedVisibleBucket: true });
    expect(await planDisplayAdvance({ currentSequence: -1, barCount: 120, sourceSeconds: 1, displaySeconds: 300, session, count: 1 }, async () => [])).toBeNull();
  });
});
