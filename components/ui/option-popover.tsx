"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "@/lib/utils";

export const OptionPopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
  <PopoverPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    collisionPadding={collisionPadding}
    className={cn(
      "z-[200] flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[28rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border bg-white p-2 text-slate-950 shadow-lg",
      className,
    )}
    {...props}
  />
));
OptionPopoverContent.displayName = "OptionPopoverContent";
