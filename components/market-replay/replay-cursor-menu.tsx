"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Crosshair, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import type { ReplayCursorMode } from "@/lib/market-replay/cursor-mode";
import { replayToolButtonColors } from "./replay-toolbar-icons";

export function ReplayCursorMenu({ value, onChange }: { value: ReplayCursorMode; onChange: (value: ReplayCursorMode) => void }) {
  const [open, setOpen] = useState(false);
  const selected = value === "pointer" ? copy.marketReplay.cursorPointer : copy.marketReplay.cursorCrosshair;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button type="button" variant="ghost" size="icon" className={`h-9 w-9 shrink-0 ${replayToolButtonColors}`} aria-label={copy.marketReplay.cursorCurrent(selected)} title={copy.marketReplay.cursorCurrent(selected)}>
        {value === "pointer" ? <MousePointer2 className="h-[18px] w-[18px]" aria-hidden="true" /> : <Crosshair className="h-[18px] w-[18px]" aria-hidden="true" />}
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content side="right" align="start" sideOffset={8} collisionPadding={8} className="z-[80] w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
        <div role="group" aria-label={copy.marketReplay.cursorSelect}>
          {(["pointer", "crosshair"] as const).map(mode => <button key={mode} type="button" aria-pressed={value === mode}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => { onChange(mode); setOpen(false); }}>
            {mode === "pointer" ? <MousePointer2 className="h-4 w-4" aria-hidden="true" /> : <Crosshair className="h-4 w-4" aria-hidden="true" />}
            <span>{mode === "pointer" ? copy.marketReplay.cursorPointer : copy.marketReplay.cursorCrosshair}</span>
            {value === mode ? <Check className="ml-auto h-4 w-4" aria-hidden="true" /> : null}
          </button>)}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
