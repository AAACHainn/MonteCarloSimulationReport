"use client";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";

export function TablePagination({ page, totalPages, onPageChange, label, busy = false }: {
  page: number; totalPages: number; onPageChange: (page: number) => void; label: string; busy?: boolean;
}) {
  const t = copy.common.pagination;
  return <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
    <p className="text-xs tabular-nums text-slate-600 dark:text-secondary-text" role="status">{t.page(formatInteger(page), formatInteger(totalPages))}</p>
    <div className="flex gap-2">
      <Button type="button" variant="outline" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>{t.previous}</Button>
      <Button type="button" variant="outline" disabled={busy || page >= totalPages} onClick={() => onPageChange(page + 1)}>{t.next}</Button>
    </div>
  </nav>;
}
