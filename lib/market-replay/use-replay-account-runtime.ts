"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { createPaperDeltaAccumulator, type PaperDeltaAccumulator } from "./client-sync";

/** Volatile account/sync state. None of these coordination tokens are persisted. */
export function useReplayAccountRuntime(
  paperSnapshot: PaperSessionSnapshot | null,
  setPaperSnapshot: Dispatch<SetStateAction<PaperSessionSnapshot | null>>,
) {
  const paperSnapshotRef = useRef<PaperSessionSnapshot | null>(paperSnapshot);
  const confirmedPaperSnapshotRef = useRef<PaperSessionSnapshot | null>(null);
  const paperSessionLoadedRef = useRef(false);
  const paperSessionLoadRef = useRef<Promise<void>>(Promise.resolve());
  const paperMutationActiveRef = useRef(false);
  const paperMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPaperMutationsRef = useRef(0);
  const syncingRef = useRef(false);
  const syncCompletionRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const lastSyncStartedAtRef = useRef(0);
  const syncLatencyMsRef = useRef(500);
  const syncRequestCounterRef = useRef(0);
  const paperDeltaAccumulatorRef = useRef<PaperDeltaAccumulator>(createPaperDeltaAccumulator(-1));

  useEffect(() => { paperSnapshotRef.current = paperSnapshot; }, [paperSnapshot]);

  const commitPaperSnapshot = useCallback((snapshot: PaperSessionSnapshot | null) => {
    paperSnapshotRef.current = snapshot;
    setPaperSnapshot(snapshot);
  }, [setPaperSnapshot]);

  const commitConfirmedPaperSnapshot = useCallback((snapshot: PaperSessionSnapshot | null) => {
    confirmedPaperSnapshotRef.current = snapshot;
    commitPaperSnapshot(snapshot);
  }, [commitPaperSnapshot]);

  return {
    paperSnapshotRef,
    confirmedPaperSnapshotRef,
    paperSessionLoadedRef,
    paperSessionLoadRef,
    paperMutationActiveRef,
    paperMutationChainRef,
    pendingPaperMutationsRef,
    syncingRef,
    syncCompletionRef,
    lastSyncStartedAtRef,
    syncLatencyMsRef,
    syncRequestCounterRef,
    paperDeltaAccumulatorRef,
    commitPaperSnapshot,
    commitConfirmedPaperSnapshot,
  };
}

