"use client";

import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronRight, Moon, Sun } from "lucide-react";
import { useAppearance } from "@/components/appearance-provider";
import { Button } from "@/components/ui/button";
import { OptionPopoverContent } from "@/components/ui/option-popover";
import type { AppearanceMode } from "@/lib/appearance";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AppearanceMenu({ portalContainer }: { portalContainer?: HTMLElement | null }) {
  const { mode, setMode } = useAppearance();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Partial<Record<AppearanceMode, HTMLButtonElement | null>>>({});
  const options = [{ value: "light", Icon: Sun }, { value: "dark", Icon: Moon }] as const;
  const Icon = mode === "dark" ? Moon : Sun;
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button ref={triggerRef} variant="ghost" className="w-full justify-start gap-3"
        aria-haspopup="menu" onKeyDown={event => { if (event.key === "ArrowRight") { event.preventDefault(); setOpen(true); } }}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">{copy.appearance.currentTheme(copy.appearance[mode])}</span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Button>
    </Popover.Trigger>
    <Popover.Portal container={portalContainer ?? undefined}>
      <OptionPopoverContent side="right" align="start" sideOffset={8} collisionPadding={12}
        className="w-36 p-1" role="menu" aria-label={copy.appearance.theme}
        onOpenAutoFocus={event => { event.preventDefault(); optionRefs.current[mode]?.focus(); }}
        onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); close(); }}
        onKeyDown={event => {
          if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); close(); return; }
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const current = options.findIndex(option => optionRefs.current[option.value] === document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          optionRefs.current[options[next].value]?.focus();
        }}>
        {options.map(({ value, Icon: OptionIcon }) => <Button key={value} ref={element => { optionRefs.current[value] = element; }}
          variant="ghost" role="menuitemradio" aria-checked={mode === value} tabIndex={mode === value ? 0 : -1}
          className={cn("w-full justify-start gap-3", mode === value && "bg-slate-100 dark:bg-hover")}
          onClick={() => { setMode(value); close(); }}>
          <OptionIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">{copy.appearance[value]}</span>
          {mode === value && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
        </Button>)}
      </OptionPopoverContent>
    </Popover.Portal>
  </Popover.Root>;
}
