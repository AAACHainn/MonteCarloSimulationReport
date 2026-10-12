"use client";

import {
  forwardRef, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode,
} from "react";
import { copy } from "@/lib/i18n";
import {
  dialogSizeLimits, fitDialogBounds, moveDialogBounds, parseDialogDimension, resizeDialogBounds,
  type DialogBounds, type DialogResizeEdge, type DialogViewport,
} from "@/lib/ui/dialog-resize";
import { cn } from "@/lib/utils";

const handles: Array<{ edge: DialogResizeEdge; className: string }> = [
  { edge: "n", className: "-top-1 left-3 right-3 h-2 cursor-n-resize" },
  { edge: "ne", className: "-right-1 -top-1 h-4 w-4 cursor-ne-resize" },
  { edge: "e", className: "-right-1 bottom-3 top-3 w-2 cursor-e-resize" },
  { edge: "se", className: "-bottom-1 -right-1 h-4 w-4 cursor-se-resize" },
  { edge: "s", className: "-bottom-1 left-3 right-3 h-2 cursor-s-resize" },
  { edge: "sw", className: "-bottom-1 -left-1 h-4 w-4 cursor-sw-resize" },
  { edge: "w", className: "-left-1 bottom-3 top-3 w-2 cursor-w-resize" },
  { edge: "nw", className: "-left-1 -top-1 h-4 w-4 cursor-nw-resize" },
];

const moveDirections = new Map<string, [number, number]>([
  ["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]], ["ArrowUp", [0, -1]], ["ArrowDown", [0, 1]],
]);

function viewport(): DialogViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

function rememberDimension(key: string | undefined, value: number) {
  if (!key) return;
  try { window.localStorage.setItem(key, String(value)); } catch {
    // Resizing still works when browser storage is unavailable.
  }
}

type ResizeDrag = {
  pointerId: number;
  edge: DialogResizeEdge | "move";
  startX: number;
  startY: number;
  start: DialogBounds;
  latest: DialogBounds;
  target: HTMLDivElement;
};

function rememberSize(widthKey: string | undefined, heightKey: string | undefined, size: DialogBounds) {
  rememberDimension(widthKey, size.width);
  rememberDimension(heightKey, size.height);
}

function releaseDrag(drag: ResizeDrag | null, widthKey: string | undefined, heightKey: string | undefined) {
  if (!drag) return;
  if (drag.edge !== "move") rememberSize(widthKey, heightKey, drag.latest);
  if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
}

export const DialogResizeFrame = forwardRef<HTMLElement, {
  children: ReactNode;
  titleId: string;
  descriptionId?: string;
  widthStorageKey?: string;
  heightStorageKey?: string;
}>(({ children, titleId, descriptionId, widthStorageKey, heightStorageKey }, forwardedRef) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ResizeDrag | null>(null);
  const explicitBoundsRef = useRef<DialogBounds | null>(null);
  const [bounds, setBounds] = useState<DialogBounds | null>(null);
  const [preferredSize, setPreferredSize] = useState<{ width: number | null; height: number | null }>({ width: null, height: null });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [currentViewport, setCurrentViewport] = useState<DialogViewport | null>(null);
  const [interacting, setInteracting] = useState(false);

  useLayoutEffect(() => {
    try {
      const savedWidth = widthStorageKey ? parseDialogDimension(window.localStorage.getItem(widthStorageKey)) : null;
      const savedHeight = heightStorageKey ? parseDialogDimension(window.localStorage.getItem(heightStorageKey)) : null;
      const limits = dialogSizeLimits(viewport());
      setPreferredSize({
        width: savedWidth === null ? null : Math.min(limits.maximumWidth, Math.max(limits.minimumWidth, savedWidth)),
        height: savedHeight === null ? null : Math.min(limits.maximumHeight, Math.max(limits.minimumHeight, savedHeight)),
      });
    } catch {
      setPreferredSize({ width: null, height: null });
    }
  }, [heightStorageKey, widthStorageKey]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      if (explicitBoundsRef.current) return;
      const rect = frame.getBoundingClientRect();
      setNaturalSize((current) => current.width === rect.width && current.height === rect.height
        ? current : { width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const endDrag = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      releaseDrag(drag, widthStorageKey, heightStorageKey);
      setInteracting(false);
    };
    const keepInViewport = () => {
      endDrag();
      const nextViewport = viewport();
      setCurrentViewport(nextViewport);
      if (explicitBoundsRef.current) {
        const next = fitDialogBounds(explicitBoundsRef.current, nextViewport);
        explicitBoundsRef.current = next;
        setBounds(next);
      }
    };
    keepInViewport();
    window.addEventListener("resize", keepInViewport);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("resize", keepInViewport);
      window.removeEventListener("blur", endDrag);
      const drag = dragRef.current;
      dragRef.current = null;
      releaseDrag(drag, widthStorageKey, heightStorageKey);
    };
  }, [heightStorageKey, widthStorageKey]);

  function applyBounds(next: DialogBounds, edge: DialogResizeEdge | "move") {
    explicitBoundsRef.current = next;
    setBounds(next);
    if (edge !== "move") setPreferredSize({ width: next.width, height: next.height });
  }

  function startDrag(edge: DialogResizeEdge | "move", event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = fitDialogBounds(rect, viewport());
    dragRef.current = {
      pointerId: event.pointerId, edge, startX: event.clientX, startY: event.clientY,
      start, latest: start, target: event.currentTarget,
    };
    setInteracting(true);
  }

  function moveHandle(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    const header = target.closest("[data-dialog-drag-handle]");
    if (!header || !frameRef.current?.contains(header)) return null;
    if (target.closest("button, input, textarea, select, a, [role='button'], [contenteditable]")) return null;
    return header;
  }

  function startMove(event: PointerEvent<HTMLDivElement>) {
    if (moveHandle(event.target)) startDrag("move", event);
  }

  function continueDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const next = drag.edge === "move"
      ? moveDialogBounds(drag.start, deltaX, deltaY, viewport())
      : resizeDialogBounds(drag.start, drag.edge, deltaX, deltaY, viewport());
    drag.latest = next;
    applyBounds(next, drag.edge);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releaseDrag(drag, widthStorageKey, heightStorageKey);
    setInteracting(false);
  }

  function resizeWithKeyboard(edge: DialogResizeEdge, event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const horizontal = edge === "e" || edge === "w";
    const keys = horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const delta = (event.shiftKey ? 24 : 8) * (event.key === keys[0] ? -1 : 1);
    const next = resizeDialogBounds(rect, edge, horizontal ? delta : 0, horizontal ? 0 : delta, viewport());
    applyBounds(next, edge);
    rememberSize(widthStorageKey, heightStorageKey, next);
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || !moveHandle(event.target)) return;
    const direction = moveDirections.get(event.key);
    if (!direction) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    applyBounds(moveDialogBounds(rect, direction[0] * step, direction[1] * step, viewport()), "move");
  }

  const size = bounds ?? naturalSize;
  const limits = currentViewport ? dialogSizeLimits(currentViewport) : null;
  const style: CSSProperties | undefined = bounds
    ? { position: "fixed", ...bounds, maxWidth: "calc(100vw - 2rem)", maxHeight: "calc(100dvh - 2rem)" }
    : preferredSize.width !== null || preferredSize.height !== null ? {
      width: preferredSize.width ?? undefined,
      height: preferredSize.height ?? undefined,
      maxWidth: preferredSize.width !== null ? "calc(100vw - 2rem)" : undefined,
      maxHeight: "calc(100dvh - 2rem)",
    } : undefined;

  return <div
    ref={(element) => {
      frameRef.current = element;
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    }}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    tabIndex={-1}
    className={cn("relative w-full max-w-2xl", interacting && "select-none")}
    style={style}
    onMouseDown={(event) => event.stopPropagation()}
    onPointerDownCapture={startMove}
    onPointerMove={continueDrag}
    onPointerUp={finishDrag}
    onPointerCancel={finishDrag}
    onLostPointerCapture={finishDrag}
    onKeyDown={moveWithKeyboard}
  >
    {children}
    {handles.map(({ edge, className }) => {
      const isEdge = edge.length === 1;
      const horizontal = edge === "n" || edge === "s";
      return <div
        key={edge}
        role={isEdge ? "separator" : undefined}
        aria-hidden={isEdge ? undefined : true}
        aria-orientation={isEdge ? horizontal ? "horizontal" : "vertical" : undefined}
        aria-label={isEdge ? copy.common.resizeDialogEdge(copy.common.dialogResizeEdges[edge]) : undefined}
        aria-valuenow={isEdge ? Math.round(horizontal ? size.height : size.width) : undefined}
        aria-valuemin={isEdge && limits ? horizontal ? limits.minimumHeight : limits.minimumWidth : undefined}
        aria-valuemax={isEdge && limits ? horizontal ? limits.maximumHeight : limits.maximumWidth : undefined}
        tabIndex={isEdge ? 0 : undefined}
        title={copy.common.resizeDialogHint}
        className={cn("absolute z-10 touch-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
        onPointerDown={(event) => startDrag(edge, event)}
        onKeyDown={isEdge ? (event) => resizeWithKeyboard(edge, event) : undefined}
      />;
    })}
  </div>;
});
DialogResizeFrame.displayName = "DialogResizeFrame";
