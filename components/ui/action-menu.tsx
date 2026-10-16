"use client";
import * as Popover from "@radix-ui/react-popover";
import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { OptionPopoverContent } from "./option-popover";

export function ActionMenu({ trigger, label, items, layerClassName = "z-[70]" }: {
  trigger: ReactNode; label: string; layerClassName?: string;
  items: Array<{ label: string; icon?: ReactNode; disabled?: boolean; destructive?: boolean; onSelect: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild>{trigger}</Popover.Trigger><Popover.Portal>
    <OptionPopoverContent aria-label={label} align="end" sideOffset={6} collisionPadding={16} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    }} className={layerClassName + " w-56 overflow-y-auto rounded-lg p-1"}>
      <div className="space-y-1">{items.map((item) => <Popover.Close asChild key={item.label}>
        <Button variant="ghost" disabled={item.disabled} onClick={item.onSelect} className={"w-full justify-start whitespace-normal text-left " + (item.destructive ? "text-red-700 hover:text-red-700" : "")}>{item.icon}{item.label}</Button>
      </Popover.Close>)}</div>
    </OptionPopoverContent>
  </Popover.Portal></Popover.Root>;
}
