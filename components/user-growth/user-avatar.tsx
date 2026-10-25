"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AvatarValue } from "@/lib/user-growth/types";
import styles from "./user-growth.module.css";

export function UserAvatar({ avatar, size = "list" }: { avatar: AvatarValue; size?: "entry" | "control" | "list" | "profile" | "crop" }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const sizes = { entry: "h-7 w-7", control: "h-10 w-10", list: "h-8 w-8", profile: "h-20 w-20", crop: "h-40 w-40" };
  return <span aria-hidden="true" data-preset={avatar.preset} className={cn(styles.theme, styles.avatar, sizes[size], "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-300")}>
    {avatar.src && failedSrc !== avatar.src ?
      // Local image drafts cannot use the Next image loader. Upload is not persisted by this view.
      // eslint-disable-next-line @next/next/no-img-element
      <img alt="" src={avatar.src} onError={() => setFailedSrc(avatar.src)} className="h-full w-full object-cover" style={{ objectPosition: `${avatar.x}% ${avatar.y}%`, transform: `scale(${avatar.zoom})`, transformOrigin: `${avatar.x}% ${avatar.y}%` }} /> :
      <UserRound className="h-3/5 w-3/5" strokeWidth={1.3} />}
  </span>;
}
