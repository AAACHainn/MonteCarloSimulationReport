import { SqliteCommitUncertainError } from "@/lib/sqlite-write";
import { avatarCrop, AVATAR_MAX_BYTES } from "./avatar";
import { avatarError, encodeAvatar, writeAvatar } from "./avatar-storage";
import { profileInput, requireProfile, saveProfile } from "./service";

async function boundedBody(request: Request, maximum: number) {
  if (Number(request.headers.get("content-length")) > maximum) throw avatarError(undefined, 413);
  const reader = request.body?.getReader();
  if (!reader) throw avatarError();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw avatarError(undefined, 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function saveProfileRequest(request: Request, id?: string) {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) {
    const bytes = await boundedBody(request, 8192);
    return saveProfile(profileInput.parse(JSON.parse(bytes.toString("utf8"))), id);
  }
  if (!type.startsWith("multipart/form-data;")) throw avatarError();
  const body = await boundedBody(request, AVATAR_MAX_BYTES + 64 * 1024);
  const form = await new Response(body, { headers: { "Content-Type": type } }).formData();
  const allowed = new Set(["nickname", "image", "zoom", "x", "y"]);
  const keys = [...form.keys()];
  if (keys.some(key => !allowed.has(key)) || new Set(keys).size !== keys.length) throw avatarError();
  const input = profileInput.parse({ nickname: form.get("nickname") });
  const file = form.get("image");
  if (!(file instanceof File) || file.size > AVATAR_MAX_BYTES) throw avatarError();
  const crop = avatarCrop.parse(Object.fromEntries(["zoom", "x", "y"].map(key => [key, form.has(key) ? Number(form.get(key)) : NaN])));
  if (id) await requireProfile(id);
  const bytes = await encodeAvatar(new Uint8Array(await file.arrayBuffer()), file.type, crop);
  const saved = await writeAvatar(bytes);
  try { return await saveProfile(input, id, `UPLOAD:${saved.name}`); }
  catch (error) {
    // COMMIT may have persisted the reference; retain its file until the result is known.
    if (!(error instanceof SqliteCommitUncertainError)) await saved.discard().catch(() => {});
    throw error;
  }
}
