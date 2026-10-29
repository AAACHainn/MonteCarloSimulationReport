"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AvatarValue, GrowthProgress } from "@/lib/user-growth/types";
import styles from "./user-growth.module.css";
import { presetAvatarUrl } from "@/lib/user-growth/avatar";

const realmFrames: Record<GrowthProgress["realm"], string> = {
  mortal: "/avatar-realms/mortal.svg",
  qi: "/avatar-realms/qi-refining.svg",
  foundation: "/avatar-realms/foundation.svg",
};

export function UserAvatar({ avatar, size = "list", realm }: { avatar: AvatarValue; size?: "compact" | "entry" | "control" | "list" | "profile" | "crop"; realm?: GrowthProgress["realm"] }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const src = avatar.src ?? presetAvatarUrl(avatar.preset);
  const sizes = { compact: "h-5 w-5", entry: "h-7 w-7", control: "h-10 w-10", list: "h-8 w-8", profile: "h-20 w-20", crop: "h-40 w-40" };
  const frame = realm ? realmFrames[realm] : undefined;
  const portrait = <span data-preset={avatar.preset} className={cn(styles.theme, styles.avatar, "relative inline-flex h-full w-full shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-300")}>
    {src && failedSrc !== src ?
      // Local image drafts cannot use the Next image loader. Upload is not persisted by this view.
      // eslint-disable-next-line @next/next/no-img-element
      <img alt="" src={src} onError={() => setFailedSrc(src)} className="h-full w-full object-cover" style={{ objectPosition: `${avatar.x}% ${avatar.y}%`, transform: `scale(${avatar.zoom})`, transformOrigin: `${avatar.x}% ${avatar.y}%` }} /> :
      <UserRound className="h-3/5 w-3/5" strokeWidth={1.3} />}
  </span>;
  return <span aria-hidden="true" className={cn(sizes[size], "relative inline-flex shrink-0 items-center justify-center")}>
    {portrait}
    {frame ? <>
      {/* The artwork is an independent, transparent overlay; the avatar remains clipped inside it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frame} alt="" className="pointer-events-none absolute -left-[30%] -top-[30%] h-[160%] w-[160%] max-w-none" />
    </> : null}
  </span>;
}
