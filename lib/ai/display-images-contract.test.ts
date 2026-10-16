import { describe, expect, it } from "vitest";
import { displayedImagesFromCalls, mergeDisplayedImages, type DisplayedImage } from "./display-images-contract";

const image = (no: number): DisplayedImage => ({ assetId: `00000000-0000-4000-8000-${String(no).padStart(12, "0")}`, sourceRef: `source:${no}`,
  contentHash: "a".repeat(64), windowHash: "window", variantRef: "variant:window", caption: "图表窗口", symbol: "TEST", timeframe: "5m", displaySession: "ETH", timezone: "UTC",
  actualTimeRange: ["2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z"], asOfTime: "2026-10-01T01:01:00Z", cutoffSequence: 60, origin: "BROWSER_RECONSTRUCTED", mime: "image/png" });
const published = (images: DisplayedImage[]) => ({ name: "display_images", status: "COMPLETED", result: JSON.stringify({ ok: true, data: { images } }) });

describe("reply image recovery", () => {
  it("preserves publication order without duplicating replayed or repeated events", () => {
    expect(displayedImagesFromCalls([published([image(2), image(1)]), published([image(1), image(3)])]).map((i) => i.assetId)).toEqual([image(2), image(1), image(3)].map((i) => i.assetId));
    expect(mergeDisplayedImages([image(2), image(1)], [image(1), image(3)])).toEqual([image(2), image(1), image(3)]);
  });
  it("does not turn a read, failed publication or incomplete record into a visible attachment", () => {
    expect(displayedImagesFromCalls([{ ...published([image(1)]), name: "get_chart_images" }, { ...published([image(1)]), status: "FAILED" },
      { ...published([image(1)]), result: "incomplete" }, published([{ ...image(1), origin: "FORGED_URL" } as unknown as DisplayedImage])])).toEqual([]);
  });
  it("bounds restored history and stream events to the same twelve images", () => {
    const restored = displayedImagesFromCalls(Array.from({ length: 4 }, (_, batch) => published(Array.from({ length: 4 }, (_, offset) => image(batch * 4 + offset)))));
    expect(restored).toHaveLength(12); expect(restored.at(-1)?.assetId).toBe(image(11).assetId);
  });
});
