import { z } from "zod";
import type { AvatarValue } from "./types";

export const AVATAR_PRESET_COUNT = 8;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 24_000_000;
export const AVATAR_MAX_EDGE = 8192;
export const AVATAR_MIN_EDGE = 64;
export const AVATAR_OUTPUT_SIZE = 512;
export const avatarCrop = z.object({ zoom: z.number().min(1).max(3), x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict();
export const avatarChoice = z.object({ preset: z.number().int().min(0).max(AVATAR_PRESET_COUNT - 1) }).strict();
export const avatarFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
export function presetAvatarUrl(preset: number) {
  return Number.isInteger(preset) && preset >= 0 && preset < AVATAR_PRESET_COUNT ? `/avatars/cultivator-${preset + 1}.webp` : undefined;
}
export function decodeAvatar(value?: string): AvatarValue {
  const base = { preset: -1, zoom: 1, x: 50, y: 50 };
  if (value && /^PRESET:[0-7]$/.test(value)) {
    const preset = Number(value.slice(7));
    if (presetAvatarUrl(preset)) return { ...base, preset };
  }
  if (value?.startsWith("UPLOAD:") && avatarFilePattern.test(value.slice(7))) return { ...base, src: `/api/user-avatars/${value.slice(7)}` };
  return base;
}
/** Matches object-fit:cover followed by zoom about the selected percentage. */
export function avatarCropRegion(width: number, height: number, crop: z.infer<typeof avatarCrop>) {
  const size = Math.max(1, Math.floor(Math.min(width, height) / crop.zoom));
  return { left: Math.round((width - size) * crop.x / 100), top: Math.round((height - size) * crop.y / 100), width: size, height: size };
}
export function validAvatarDimensions(width: number, height: number) {
  return width >= AVATAR_MIN_EDGE && height >= AVATAR_MIN_EDGE && width <= AVATAR_MAX_EDGE && height <= AVATAR_MAX_EDGE && width * height <= AVATAR_MAX_PIXELS;
}
