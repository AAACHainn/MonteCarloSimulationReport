"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, onClick, ...props }, ref) => (
    <button {...props} ref={ref} type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn("inline-flex h-10 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", className)}>
      <span aria-hidden="true" className={cn("inline-flex h-6 w-11 items-center rounded-full transition-colors motion-reduce:transition-none", checked ? "bg-primary" : "bg-slate-300")}>
        <span className={cn("h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0.5")} />
      </span>
    </button>
  ),
);
Switch.displayName = "Switch";
