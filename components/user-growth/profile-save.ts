import { copy } from "@/lib/i18n";
import type { AvatarValue, UserIdentity } from "@/lib/user-growth/types";

export async function writeProfile(nickname: string, avatar: AvatarValue, image?: File, id?: string) {
  let body: FormData | string;
  const headers: Record<string, string> = {};
  if (image) {
    const form = new FormData(); form.set("nickname", nickname); form.set("image", image);
    for (const field of ["zoom", "x", "y"] as const) form.set(field, String(avatar[field]));
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ nickname, ...(!avatar.src && avatar.preset >= 0 ? { avatar: { preset: avatar.preset } } : {}) });
  }
  const response = await fetch(id ? `/api/users/${encodeURIComponent(id)}` : "/api/users", { method: id ? "PATCH" : "POST", headers, body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? copy.userGrowth.requestFailed);
  return result.user as UserIdentity;
}
