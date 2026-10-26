"use client";

import { settledGrowthNotice } from "@/lib/user-growth/presentation";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";

/** Volatile account/sync state. None of these coordination tokens are persisted. */
export function useReplayAccountRuntime(
  paperSnapshot: PaperSessionSnapshot | null,
  setPaperSnapshot: Dispatch<SetStateAction<PaperSessionSnapshot | null>>,
) {
  const [growthFeedback, setGrowthFeedback] = useState<{ message: string; revision: number } | null>(null);
  const growthRevision = useRef(0);
  const paperSnapshotRef = useRef<PaperSessionSnapshot | null>(paperSnapshot);
  const confirmedPaperSnapshotRef = useRef<PaperSessionSnapshot | null>(null);
  const paperSessionLoadedRef = useRef(false);
  const paperSessionLoadRef = useRef<Promise<void>>(Promise.resolve());
  const paperMutationActiveRef = useRef(false);
  const paperMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPaperMutationsRef = useRef(0);

  useEffect(() => { paperSnapshotRef.current = paperSnapshot; }, [paperSnapshot]);
  useEffect(() => {
    if (!growthFeedback) return;
    const timer = setTimeout(() => setGrowthFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [growthFeedback]);

  const commitPaperSnapshot = useCallback((snapshot: PaperSessionSnapshot | null) => {
    paperSnapshotRef.current = snapshot;
    setPaperSnapshot(snapshot);
  }, [setPaperSnapshot]);

  const commitConfirmedPaperSnapshot = useCallback((snapshot: PaperSessionSnapshot | null) => {
    const notice = settledGrowthNotice(confirmedPaperSnapshotRef.current?.growth, snapshot?.growth);
    if (notice) setGrowthFeedback({ message: notice, revision: ++growthRevision.current });
    else if (confirmedPaperSnapshotRef.current?.session.id !== snapshot?.session.id) setGrowthFeedback(null);
    confirmedPaperSnapshotRef.current = snapshot;
    commitPaperSnapshot(snapshot);
  }, [commitPaperSnapshot]);

  return {
    growthNotice: growthFeedback?.message ?? null, growthNoticeKey: growthFeedback?.revision ?? 0, paperSnapshotRef,
    confirmedPaperSnapshotRef,
    paperSessionLoadedRef,
    paperSessionLoadRef,
    paperMutationActiveRef,
    paperMutationChainRef,
    pendingPaperMutationsRef,
    commitPaperSnapshot,
    commitConfirmedPaperSnapshot,
  };
}

