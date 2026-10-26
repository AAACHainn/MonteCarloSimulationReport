"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AvatarValue, UserIdentity } from "@/lib/user-growth/types";
import { UserAvatar } from "./user-avatar";
import { AVATAR_MAX_BYTES, AVATAR_PRESET_COUNT, validAvatarDimensions } from "@/lib/user-growth/avatar";

const t = copy.userGrowth;
export function ProfileDialog({ user, description, defaultAvatarOnly = false, onClose, onSave }: { defaultAvatarOnly?: boolean; user?: UserIdentity; description?: string; onClose: () => void; onSave: (nickname: string, avatar: AvatarValue, image?: File) => Promise<string | null> }) {
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [avatar, setAvatar] = useState<AvatarValue>(user?.avatar ?? { preset: 0, zoom: 1, x: 50, y: 50 });
  const [tab, setTab] = useState<"presets" | "upload">(user?.avatar.src ? "upload" : "presets");
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState("");
  const [uploadFile, setUploadFile] = useState<File>();
  const revision = useRef(0);
  useEffect(() => () => { revision.current += 1; }, []);
  const readImage = (file?: File) => {
    const request = ++revision.current;
    setImageError("");
    if (!file) { setReading(false); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > AVATAR_MAX_BYTES) { setImageError(t.uploadError); setReading(false); return; }
    setReading(true);
    const reader = new FileReader();
    const fail = () => { if (revision.current === request) { setImageError(t.uploadError); setReading(false); } };
    reader.onerror = fail;
    reader.onload = () => {
      if (revision.current !== request) return;
      const src = typeof reader.result === "string" ? reader.result : "";
      const image = new Image();
      image.onerror = fail;
      image.onload = () => { if (revision.current === request) { if (!validAvatarDimensions(image.naturalWidth, image.naturalHeight)) { fail(); return; } setAvatar({ preset: -1, src, zoom: 1, x: 50, y: 50 }); setUploadFile(file); setReading(false); } };
      image.src = src;
    };
    reader.readAsDataURL(file);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (saving || reading || imageError) return;
    setError("");
    if (!nickname.trim() || Array.from(nickname.trim()).length > 24) { setError(t.nicknameError); return; }
    setSaving(true);
    try { const message = await onSave(nickname.trim(), avatar, uploadFile); if (message) setError(message); }
    catch { setError(t.requestFailed); }
    finally { setSaving(false); }
  };
  return <Dialog open title={user ? t.edit : t.create} description={description} onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={submit} className="space-y-5" aria-busy={saving || reading}>
      <div className="grid gap-6 sm:grid-cols-[1fr_180px]"><div className="space-y-2"><Label htmlFor="growth-nickname">{t.nickname}</Label><Input id="growth-nickname" autoComplete="off" value={nickname} disabled={saving} onChange={(e) => setNickname(e.target.value)} aria-invalid={!!error} aria-describedby="growth-name-help growth-profile-error" /><p id="growth-name-help" className="text-xs leading-5 text-slate-600">{defaultAvatarOnly ? t.nicknameError : t.nicknameHint}</p><p className="pt-4 text-sm text-slate-700">{user?.realmLabel ?? t.mortal}{!user && ` · 0 ${t.xp}`}</p></div><div className="flex flex-col items-center gap-2"><UserAvatar avatar={avatar} size="crop" /><p className="text-xs text-slate-600">{t.avatar}</p></div></div>
      {!defaultAvatarOnly && <><div className="flex gap-2 border-b pb-3"><Button type="button" variant={tab === "presets" ? "secondary" : "ghost"} aria-pressed={tab === "presets"} disabled={saving} onClick={() => { revision.current++; setReading(false); setTab("presets"); }}>{t.presets}</Button><Button type="button" variant={tab === "upload" ? "secondary" : "ghost"} aria-pressed={tab === "upload"} disabled={saving} onClick={() => { revision.current++; setReading(false); setTab("upload"); }}>{t.upload}</Button></div>
      {tab === "presets" ? <div><div className="grid grid-cols-4 gap-3">{Array.from({ length: AVATAR_PRESET_COUNT }, (_, i) => i).map((preset) => <Button key={preset} type="button" variant="outline" disabled={saving} className={cn("relative h-20 w-full flex-col gap-1", !avatar.src && avatar.preset === preset && "border-blue-600 ring-1 ring-blue-600")} aria-label={t.presetNames[preset]} aria-pressed={!avatar.src && avatar.preset === preset} onClick={() => { revision.current += 1; setReading(false); setImageError(""); setUploadFile(undefined); setAvatar({ preset, zoom: 1, x: 50, y: 50 }); }}><UserAvatar avatar={{ preset, zoom: 1, x: 50, y: 50 }} size="control" />{!avatar.src && avatar.preset === preset && <Check className="absolute right-1 top-1 h-4 w-4 text-blue-700" aria-hidden="true" />}</Button>)}</div><p className="mt-3 text-xs text-slate-600">{t.presetHint}</p></div> : <div className="space-y-4"><div className="space-y-2"><Label htmlFor="growth-upload">{t.upload}</Label><Input id="growth-upload" type="file" accept="image/png,image/jpeg,image/webp" disabled={saving} onClick={(e) => { e.currentTarget.value = ""; }} onChange={(e) => readImage(e.target.files?.[0])} aria-describedby="growth-upload-help growth-image-error" /><p id="growth-upload-help" className="text-xs leading-5 text-slate-600">{t.uploadHint}</p></div>
        {reading && <p role="status" className="text-sm text-slate-600">{t.uploadReading}</p>}
        {avatar.src && uploadFile && <div className="space-y-3">{(["zoom", "x", "y"] as const).map((field) => <div key={field} className="grid grid-cols-[100px_1fr] items-center gap-3"><Label htmlFor={`growth-${field}`}>{field === "zoom" ? t.zoom : field === "x" ? t.positionX : t.positionY}</Label><input id={`growth-${field}`} type="range" min={field === "zoom" ? 1 : 0} max={field === "zoom" ? 3 : 100} step={field === "zoom" ? .05 : 1} disabled={saving || reading} value={avatar[field]} onChange={(e) => setAvatar({ ...avatar, [field]: Number(e.target.value) })} className="h-10 w-full accent-blue-600 focus-visible:ring-2 focus-visible:ring-ring" /></div>)}<p className="text-xs text-slate-600">{t.cropHint}</p></div>}
      </div>}
      </>}
      <p id="growth-image-error" role={imageError ? "alert" : undefined} className="text-sm text-red-700">{imageError}</p><p id="growth-profile-error" role={error ? "alert" : undefined} className="text-sm text-red-700">{error}</p>
      <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t.cancel}</Button><Button type="submit" disabled={saving || reading || !!imageError}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{saving ? t.saving : user ? t.save : t.create}</Button></div>
    </form>
  </Dialog>;
}
