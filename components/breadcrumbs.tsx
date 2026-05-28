import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav className={cn("flex items-center gap-1 text-sm text-slate-500", className)} aria-label="Breadcrumb">
      <Link href="/" className="inline-flex items-center gap-1 rounded-sm hover:text-slate-950">
        <Home className="h-3.5 w-3.5" />
        <span>{copy.nav.home}</span>
      </Link>
      {items.map((item) => (
        <span key={`${item.href ?? "current"}-${item.label}`} className="inline-flex min-w-0 items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {item.href ? (
            <Link href={item.href} className="truncate rounded-sm hover:text-slate-950">
              {item.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-slate-800" aria-current="page">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
