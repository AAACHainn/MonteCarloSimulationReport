import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildTradeDuplicateKey, isSafeArchivePath, readTradeJournalBackup } from "./backup";

async function createBackupFile(strategyCode?: string | null) {
  const zip = new JSZip();
  const trade = {
    date: "2026-05-12T00:00:00.000Z",
    instrument: "Emini",
    strategy: "Trend",
    entryPrice: 100,
    stopLossPrice: 90,
    riskAmount: 500,
    targetPrice: 120,
    exitPrice: 115,
    screenshotFile: "screenshots/trade-1.png",
    ...(strategyCode === undefined ? {} : { strategyCode }),
  };
  zip.file("manifest.json", JSON.stringify({
    version: 1,
    journal: { name: "Test", description: null },
    trades: [trade],
  }));
  zip.file("screenshots/trade-1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const buffer = await zip.generateAsync({ type: "uint8array" });
  return new File([buffer], "backup.zip", { type: "application/zip" });
}

describe("isSafeArchivePath", () => {
  it("accepts screenshot paths inside the archive", () => {
    expect(isSafeArchivePath("screenshots/trade-1.png")).toBe(true);
  });

  it("rejects traversal paths", () => {
    expect(isSafeArchivePath("../outside.png")).toBe(false);
    expect(isSafeArchivePath("screenshots/../../outside.png")).toBe(false);
    expect(isSafeArchivePath("C:\\outside.png")).toBe(false);
  });
});

describe("buildTradeDuplicateKey", () => {
  it("uses date, instrument, entry, stop, and target as the duplicate identity", () => {
    expect(
      buildTradeDuplicateKey({
        date: "2026-05-12T08:30:00.000Z",
        instrument: "Emini",
        entryPrice: 7366.5,
        stopLossPrice: 7363,
        targetPrice: 7374.25,
      }),
    ).toBe("2026-05-12|Emini|7366.5|7363|7374.25");
  });

  it("returns null when the trade is missing identity fields", () => {
    expect(
      buildTradeDuplicateKey({
        date: null,
        instrument: "Emini",
        entryPrice: 7366.5,
        stopLossPrice: 7363,
        targetPrice: 7374.25,
      }),
    ).toBeNull();
  });
});

describe("strategyCode backup compatibility", () => {
  it("imports old backups without strategyCode as an unrated trade", async () => {
    const backup = await readTradeJournalBackup(await createBackupFile());
    expect(backup.manifest.trades[0].strategyCode).toBeNull();
  });

  it("normalizes strategyCode from new backups", async () => {
    const backup = await readTradeJournalBackup(await createBackupFile("  qs:a   dn:s "));
    expect(backup.manifest.trades[0].strategyCode).toBe("QS:A DN:S");
  });

  it("rejects invalid strategyCode from new backups", async () => {
    await expect(readTradeJournalBackup(await createBackupFile("QS:A QS:B"))).rejects.toThrow("发现重复项目QS。");
  });
});
