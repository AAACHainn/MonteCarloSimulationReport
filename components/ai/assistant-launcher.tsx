"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { fitFloatingPosition, parseFloatingPosition, type FloatingPosition } from "@/lib/ui/floating-position";

const POSITION_KEY = "ai-launcher-position-v1";
const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const viewport = () => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
type Drag = { pointerId: number; startX: number; startY: number; start: FloatingPosition; latest: FloatingPosition; moved: boolean };

export function AiAssistantLauncher({ hidden, onOpen, assistantName = copy.ai.title }: { hidden: boolean; onOpen: () => void; assistantName?: string }) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const preferred = useRef<FloatingPosition | null>(null), drag = useRef<Drag | null>(null), suppressClick = useRef(false);
  const button = useRef<HTMLButtonElement>(null), hintId = useId();
  const wasHidden = useRef(hidden), returnFocus = useRef(false);
  useEffect(() => {
    try { preferred.current = parseFloatingPosition(window.localStorage.getItem(POSITION_KEY)); } catch { /* Default placement still works. */ }
    const align = () => {
      const size = viewport();
      setPosition(fitFloatingPosition(preferred.current ?? { x: size.width - 68, y: size.height - 68 }, size));
    };
    align(); window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, []);
  useEffect(() => {
    if (hidden) {
      const current = drag.current; drag.current = null;
      if (current && button.current?.hasPointerCapture(current.pointerId)) button.current.releasePointerCapture(current.pointerId);
    } else if (wasHidden.current && returnFocus.current) {
      button.current?.focus({ preventScroll: true }); returnFocus.current = false;
    }
    wasHidden.current = hidden;
  }, [hidden]);
  function remember(value: FloatingPosition) {
    preferred.current = value;
    try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(value)); } catch { /* Moving remains available without storage. */ }
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null; suppressClick.current = cancelled || current.moved;
    if (current.moved) remember(current.latest);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.stopPropagation();
  }
  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation();
    if (event.key === "Enter" || event.key === " ") suppressClick.current = false;
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect(), step = event.shiftKey ? 32 : 8;
    const next = fitFloatingPosition({ x: rect.left + direction[0] * step, y: rect.top + direction[1] * step }, viewport());
    setPosition(next); remember(next);
  }
  return <>
    <Button ref={button} type="button" size="icon" hidden={hidden} aria-hidden={hidden || undefined}
      className={"fixed z-[60] h-12 w-12 touch-none select-none rounded-lg shadow-lg cursor-grab active:cursor-grabbing" + (hidden ? " hidden" : "")}
      style={position ? { left: position.x, top: position.y } : { right: 20, bottom: 20 }} aria-label={copy.ai.openNamedAssistant(assistantName)} aria-describedby={hintId} title={assistantName + " · " + copy.ai.moveLauncherHint}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect(), start = { x: rect.left, y: rect.top };
        suppressClick.current = false;
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start, latest: start, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId); event.stopPropagation();
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
        current.moved ||= Math.hypot(dx, dy) >= 5;
        if (!current.moved) return;
        event.preventDefault(); event.stopPropagation();
        current.latest = fitFloatingPosition({ x: current.start.x + dx, y: current.start.y + dy }, viewport());
        setPosition(current.latest);
      }}
      onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)}
      onKeyDown={moveWithKeyboard} onClick={(event) => {
        event.stopPropagation();
        if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); }
        else { returnFocus.current = true; onOpen(); }
      }}>
      <Bot className="h-6 w-6" aria-hidden="true" />
    </Button>
    <span id={hintId} className="sr-only" aria-hidden={hidden || undefined}>{copy.ai.moveLauncherHint}</span>
  </>;
}
