"use client";

import { useEffect, useRef, useState } from "react";
import { StatusToast } from "@/components/ui/status-toast";
import { formatInteger } from "@/lib/format";
import { STATUS_TOAST_DURATION_MS } from "@/lib/ui/status-toast";
import type { readAchievementNotifications } from "@/lib/achievements/read";
import { achievementRequest, collectionApi, t } from "./shared";

type Feed = Awaited<ReturnType<typeof readAchievementNotifications>>;
const receiptKey = (id: string) => `achievements.receipt.v1.${id}`;

export function AchievementNotice({ userId, href }: { userId: string; href: string }) {
  const [message, setMessage] = useState<string[]>([]);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    let dismiss: ReturnType<typeof setTimeout>;
    let after: number | undefined;
    function isVisible() {
      const element = anchor.current;
      return !document.hidden && element && element.getClientRects().length > 0
        && getComputedStyle(element).visibility === "visible";
    }
    function storedReceipt() {
      try {
        const value = localStorage.getItem(receiptKey(userId));
        return value && /^\d{1,10}$/.test(value) ? Number(value) : undefined;
      } catch { return undefined; }
    }
    async function check() {
      try {
        if (!isVisible()) return;
        after = Math.max(after ?? -1, storedReceipt() ?? -1);
        const query = after >= 0 ? `?after=${after}` : "";
        const feed = await achievementRequest<Feed>(`${collectionApi(userId)}/notifications${query}`, { signal: controller.signal });
        if (controller.signal.aborted || feed.user.id !== userId || !isVisible()) return;
        const alreadySeen = storedReceipt() ?? -1;
        after = feed.latest;
        try { localStorage.setItem(receiptKey(userId), String(after)); } catch { /* In-page receipt still prevents repeats. */ }
        if (feed.count && alreadySeen < feed.latest) {
          const latest = [];
          if (feed.count > feed.historical) latest.push(t.notification(feed.user.nickname, formatInteger(feed.count - feed.historical)));
          if (feed.historical) latest.push(t.historyNotification(feed.user.nickname, formatInteger(feed.historical)));
          setMessage(latest);
          clearTimeout(dismiss);
          dismiss = setTimeout(() => setMessage([]), STATUS_TOAST_DURATION_MS);
        }
      } catch { /* The collection remains available when notification polling fails. */ }
      finally { if (!controller.signal.aborted) poll = setTimeout(check, 8_000); }
    }
    void check();
    return () => { controller.abort(); clearTimeout(poll); clearTimeout(dismiss); };
  }, [userId]);
  return <>
    <span ref={anchor} aria-hidden="true" className="pointer-events-none absolute size-px" />
    <StatusToast message={message.join("。")} action={{ href, label: t.viewAll }} />
  </>;
}
