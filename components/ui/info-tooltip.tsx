"use client";

import { useId, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild>
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-slate-500 dark:text-muted-foreground"
        aria-label={label} aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={event => { if (!event.currentTarget.matches(":focus-visible")) setOpen(false); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}>
        <Info className="h-4 w-4" aria-hidden="true" />
      </Button>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content id={id} role="tooltip" align="start" sideOffset={5} collisionPadding={12}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        className="pointer-events-none z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border bg-white dark:bg-surface-raised p-3 text-xs leading-5 text-slate-600 dark:text-secondary-text shadow-lg">
        {text}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
