import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { copy } from "@/lib/i18n";

export type ProviderErrorDetails = { method: string; case: string | null };
export class SyncError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID", public provider?: ProviderErrorDetails) { super(message); }
}
function encryptionKey() {
  const text = process.env.MARKET_DATA_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64") !== text) throw new SyncError(copy.marketSync.masterMissing, 503);
  return key;
}
export function encryptionReady() { try { encryptionKey(); return true; } catch { return false; } }
export function encryptKey(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString("base64")).join(".");
}
export function decryptKey(value: string) {
  try {
    const [iv, tag, encrypted] = value.split(".").map((v) => Buffer.from(v, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch { throw new SyncError(copy.marketSync.masterMissing, 503, "AUTH"); }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const expected = forwardedHost && ["http", "https"].includes(forwardedProto ?? "") ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin;
  // Browser mutation requests must be same-origin. CLI clients must explicitly send Origin too.
  if (!origin || origin !== expected) throw new SyncError(copy.marketSync.origin, 403);
}
