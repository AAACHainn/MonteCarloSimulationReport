import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { avatarCrop, avatarCropRegion, decodeAvatar, validAvatarDimensions } from "./avatar";
import { encodeAvatar } from "./avatar-storage";

describe("bounded avatar processing", () => {
  it("decodes only known preset and local uploaded identifiers, retaining DEFAULT as neutral", () => {
    expect(decodeAvatar("DEFAULT").preset).toBe(-1);
    expect(decodeAvatar("PRESET:7").preset).toBe(7); expect(decodeAvatar("PRESET:").preset).toBe(-1);
    expect(decodeAvatar("PRESET:8").preset).toBe(-1);
    expect(decodeAvatar("PRESET:").preset).toBe(-1);
    expect(decodeAvatar("https://example.org/a.png").src).toBeUndefined();
    expect(decodeAvatar("UPLOAD:../../x.webp").src).toBeUndefined();
    expect(decodeAvatar("UPLOAD:bd90c098-bacd-47a9-97e6-9d04aa51b184.webp").src).toMatch(/^\/api\/user-avatars\//);
  });
  it("matches cover/zoom cropping for rectangular sources and edge positions", () => {
    expect(avatarCropRegion(400, 200, { zoom: 2, x: 100, y: 0 })).toEqual({ left: 300, top: 0, width: 100, height: 100 });
    expect(avatarCropRegion(200, 400, { zoom: 1, x: 0, y: 50 })).toEqual({ left: 0, top: 100, width: 200, height: 200 });
    expect(avatarCrop.safeParse({ zoom: Infinity, x: 50, y: 50 }).success).toBe(false);
    expect(validAvatarDimensions(63, 512)).toBe(false); expect(validAvatarDimensions(8192, 8192)).toBe(false);
  });
  it("uses the chosen region and emits only 512px static WebP without EXIF", async () => {
    const left = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).png().toBuffer();
    const right = await sharp({ create: { width: 100, height: 100, channels: 3, background: "blue" } }).png().toBuffer();
    const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: "white" } }).composite([{ input: left, left: 0, top: 0 }, { input: right, left: 100, top: 0 }]).withMetadata().png().toBuffer();
    const output = await encodeAvatar(source, "image/png", { zoom: 1, x: 100, y: 50 });
    expect(await sharp(output).metadata()).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect((await sharp(output).metadata()).exif).toBeUndefined();
    const pixel = await sharp(output).extract({ left: 256, top: 256, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect(pixel[2]).toBeGreaterThan(240); expect(pixel[0]).toBeLessThan(15);
  });
  it("physically applies EXIF rotation before extracting crop coordinates", async () => {
    const source = await sharp({ create: { width: 100, height: 200, channels: 3, background: "green" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const output = await encodeAvatar(source, "image/jpeg", { zoom: 2, x: 100, y: 100 });
    const metadata = await sharp(output).metadata(); expect(metadata.width).toBe(512); expect(metadata.orientation).toBeUndefined();
  });
  it("rejects unsupported, spoofed, corrupt, too small, oversized and invalid crop inputs", async () => {
    const valid = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).png().toBuffer();
    const small = await sharp(valid).resize(32, 32).png().toBuffer();
    for (const [bytes, mime, crop] of [
      [valid, "image/jpeg", { zoom: 1, x: 50, y: 50 }], [small, "image/png", { zoom: 1, x: 50, y: 50 }],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml", { zoom: 1, x: 50, y: 50 }],
      [Buffer.from("bad"), "image/png", { zoom: 1, x: 50, y: 50 }],
      [Buffer.alloc(5 * 1024 * 1024 + 1), "image/png", { zoom: 1, x: 50, y: 50 }], [valid, "image/png", { zoom: 0, x: 50, y: 50 }],
    ] as const) await expect(encodeAvatar(bytes, mime, crop)).rejects.toMatchObject({ status: 400 });
  });
});
