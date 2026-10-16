import { z } from "zod";

export const MAX_DISPLAYED_IMAGES = 12;
export const displayImagesArguments = z.object({
  images: z.array(z.object({ assetRef: z.string().uuid(), sourceRef: z.string().min(1).max(160) }).strict()).min(1).max(4),
}).strict();

export const displayedImageSchema = z.object({
  assetId: z.string().uuid(), sourceRef: z.string().min(1).max(160), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  windowHash: z.string().min(1), variantRef: z.string().min(1),
  caption: z.string().max(4000), symbol: z.string().max(160), timeframe: z.string().max(20),
  displaySession: z.enum(["ETH", "RTH"]), timezone: z.string().max(160),
  actualTimeRange: z.tuple([z.string().datetime({ offset: true }), z.string().datetime({ offset: true })]),
  asOfTime: z.string().datetime({ offset: true }), cutoffSequence: z.number().int(),
  origin: z.literal("BROWSER_RECONSTRUCTED"), mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
}).strict();
export type DisplayedImage = z.infer<typeof displayedImageSchema>;

export function mergeDisplayedImages(current: DisplayedImage[], incoming: DisplayedImage[]) {
  const images = new Map(current.map((image) => [image.assetId, image]));
  for (const image of incoming) if (!images.has(image.assetId)) images.set(image.assetId, image);
  return [...images.values()].slice(0, MAX_DISPLAYED_IMAGES);
}

// The persisted tool result is the attachment record, independent of answer completion.
export function displayedImagesFromCalls(calls: Array<{ name: string; status: string; result: string }>): DisplayedImage[] {
  let images: DisplayedImage[] = [];
  for (const call of calls) {
    if (call.name !== "display_images" || call.status !== "COMPLETED") continue;
    try {
      const result = z.object({ ok: z.literal(true), data: z.object({ images: z.array(displayedImageSchema).max(4) }) }).parse(JSON.parse(call.result));
      images = mergeDisplayedImages(images, result.data.images);
    } catch { /* Old or incomplete protocol records do not become attachments. */ }
  }
  return images;
}
