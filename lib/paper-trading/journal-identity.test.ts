import { describe, expect, it } from "vitest";
import { entryLotId, fifoRowId, isFifoRowExit } from "./journal-identity";
describe("FIFO evidence identities", () => {
  it("preserves generated identities and distinguishes partial exits, other lots and malformed suffixes", () => {
    const lot = entryLotId("entry_fill_with_underscores");
    expect(lot).toBe("lot_entry_fill_with_underscores");
    const first = fifoRowId("exit_one", lot, 0), second = fifoRowId("exit_two", lot, 12);
    expect(isFifoRowExit(first, "exit_one", lot)).toBe(true);
    expect(isFifoRowExit(second, "exit_two", lot)).toBe(true);
    expect(isFifoRowExit(first, "exit_two", lot)).toBe(false);
    expect(isFifoRowExit(first, "exit_one", entryLotId("other"))).toBe(false);
    expect(isFifoRowExit(first + "malformed", "exit_one", lot)).toBe(false);
  });
});
