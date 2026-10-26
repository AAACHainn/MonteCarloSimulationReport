import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { copy } from "@/lib/i18n";
import { AVATAR_MAX_BYTES, AVATAR_MAX_PIXELS, AVATAR_OUTPUT_SIZE, avatarCrop, avatarCropRegion, avatarFilePattern, validAvatarDimensions } from "./avatar";

export class AvatarError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function avatarError(message = copy.userGrowth.uploadError, status = 400) { return new AvatarError(message, status); }
export function avatarDirectory() { return resolve(process.env.USER_AVATAR_DIR || join(process.cwd(), "storage", "user-avatars")); }
export async function encodeAvatar(bytes: Uint8Array, mime: string, crop: unknown) {
  if (!bytes.length || bytes.length > AVATAR_MAX_BYTES) throw avatarError();
  const selection = avatarCrop.safeParse(crop);
  if (!selection.success) throw avatarError();
  const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };
  if (!types[mime]) throw avatarError();
  if (mime === "image/png") {
    const buffer = Buffer.from(bytes);
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      if (buffer.toString("ascii", offset + 4, offset + 8) === "acTL") throw avatarError();
      offset += length + 12;
    }
  }
  try {
    const options = { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "warning" as const, animated: false };
    const metadata = await sharp(bytes, options).metadata();
    if (metadata.format !== types[mime] || (metadata.pages ?? 1) !== 1 || !validAvatarDimensions(metadata.width ?? 0, metadata.height ?? 0)) throw avatarError();
    // Physically orient before computing a crop; no EXIF or other uploaded metadata survives.
    const oriented = await sharp(bytes, options).rotate().toBuffer({ resolveWithObject: true });
    const region = avatarCropRegion(oriented.info.width, oriented.info.height, selection.data);
    return await sharp(oriented.data, options).extract(region).resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE).webp({ quality: 88 }).toBuffer();
  } catch { throw avatarError(); }
}
export async function writeAvatar(bytes: Uint8Array) {
  const name = `${randomUUID()}.webp`, path = join(avatarDirectory(), name);
  await mkdir(avatarDirectory(), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); await handle.close(); }
  catch (error) { await handle.close().catch(() => {}); await unlink(path).catch(() => {}); throw error; }
  return { name, discard: () => unlink(path) };
}
export async function readAvatar(name: string) {
  if (!avatarFilePattern.test(name)) return null;
  try { return await readFile(join(avatarDirectory(), name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
