import Link from "next/link";
import { STATUS_TOAST_DURATION_MS } from "@/lib/ui/status-toast";
import { Button } from "./button";
import styles from "./status-toast.module.css";

export function StatusToast({ message, action }: {
  message?: string | null;
  action?: { href: string; label: string };
}) {
  if (!message) return null;
  return <div className={`${styles.toast} pointer-events-none w-max max-w-full rounded-md border border-emerald-200 dark:border-positive/40 bg-emerald-50/90 dark:bg-positive-background/90 px-3 py-2 text-xs leading-5 text-emerald-800 dark:text-positive shadow-sm`}
    style={{ animationDuration: `${STATUS_TOAST_DURATION_MS}ms` }}>
    <p role="status" aria-live="polite" aria-atomic="true" className="break-words">{message}</p>
    {action && <Button asChild variant="ghost" className="pointer-events-auto mt-1 px-1 text-xs text-link underline-offset-4 hover:underline">
      <Link href={action.href}>{action.label}</Link>
    </Button>}
  </div>;
}
