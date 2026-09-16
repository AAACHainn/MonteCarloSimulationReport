"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ColumnFilterPopover({
  id,
  openFilter,
  setOpenFilter,
  active,
  label,
  disabled,
  children,
}: {
  id: string;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  active: boolean;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const isOpen = openFilter === id;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);

  function updatePanelPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const panelWidth = 288;
    const viewportPadding = 12;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
    setPanelPosition({ left, top: rect.bottom + 6 });
  }

  useEffect(() => {
    if (!isOpen) return;

    updatePanelPosition();

    function handleViewportChange() {
      updatePanelPosition();
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (target instanceof Element && target.closest("[data-date-picker-popover]")) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpenFilter((current) => current === id ? null : current);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenFilter((current) => current === id ? null : current);
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [id, isOpen, setOpenFilter]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          (active || isOpen) && "bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800",
        )}
        disabled={disabled}
        aria-label={copy.tradeJournals.filters.openColumnFilter.replace("{field}", label)}
        title={copy.tradeJournals.filters.openColumnFilter.replace("{field}", label)}
        aria-expanded={isOpen}
        onClick={() => {
          updatePanelPosition();
          setOpenFilter((current) => current === id ? null : id);
        }}
      >
        <Filter className="h-3.5 w-3.5" />
      </button>
      {isOpen && panelPosition && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] w-72 rounded-md border bg-white p-3 text-left text-slate-950 shadow-lg"
            style={{ left: panelPosition.left, top: panelPosition.top }}
          >
            {children}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
