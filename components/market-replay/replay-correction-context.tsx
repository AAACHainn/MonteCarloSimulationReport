"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { ReplayJournalEntryData } from "@/lib/paper-trading/types";

const Context = createContext<{ onDeleteCycle: (entry: ReplayJournalEntryData) => void; pending: boolean } | null>(null);
export function ReplayCorrectionProvider({ onDeleteCycle, pending, children }: { onDeleteCycle: (entry: ReplayJournalEntryData) => void; pending: boolean; children: ReactNode }) {
  return <Context.Provider value={{ onDeleteCycle, pending }}>{children}</Context.Provider>;
}
export const useDeleteReplayCycle = () => useContext(Context);
