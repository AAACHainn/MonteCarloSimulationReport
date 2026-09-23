"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { pauseReplay, playReplay } from "./engine";
import {
  createPlaybackIntentTracker,
  type ReplayAutoPauseReason,
  type ReplayPauseReason,
  type ReplayPlaybackIntent,
  type ReplaySuspension,
} from "./playback-lifecycle";
import type { ReplayState } from "./types";

export type ReplayAutoPauseEvent = {
  id: number;
  reason: ReplayAutoPauseReason;
};

export function useReplayPlayback(
  replayRef: MutableRefObject<ReplayState | null>,
  setReplay: (action: ReplayState | null | ((state: ReplayState | null) => ReplayState | null)) => void,
) {
  const trackerRef = useRef(createPlaybackIntentTracker());
  const eventSequenceRef = useRef(0);
  const [pauseReason, setPauseReason] = useState<ReplayPauseReason | null>(null);
  const [autoPauseEvent, setAutoPauseEvent] = useState<ReplayAutoPauseEvent | null>(null);

  const play = useCallback(() => {
    const intent = trackerRef.current.play();
    setAutoPauseEvent(null);
    if (trackerRef.current.canPlay()) {
      setPauseReason(null);
      setReplay((state) => state ? playReplay(state) : state);
    } else {
      setPauseReason("operation");
      setReplay((state) => state ? pauseReplay(state) : state);
    }
    return intent;
  }, [setReplay]);

  const pause = useCallback(() => {
    trackerRef.current.pause();
    setAutoPauseEvent(null);
    setPauseReason("user");
    setReplay((state) => state ? pauseReplay(state) : state);
  }, [setReplay]);

  const autoPause = useCallback((reason: ReplayAutoPauseReason, intent?: ReplayPlaybackIntent) => {
    if (intent && !trackerRef.current.isCurrent(intent)) return false;
    if (!trackerRef.current.wantsToPlay() && replayRef.current?.status !== "playing") return false;
    trackerRef.current.pause();
    setPauseReason(reason);
    setAutoPauseEvent({ id: ++eventSequenceRef.current, reason });
    setReplay((state) => state ? pauseReplay(state) : state);
    return true;
  }, [replayRef, setReplay]);

  const suspend = useCallback(() => {
    const shouldPause = trackerRef.current.wantsToPlay() || replayRef.current?.status === "playing";
    const suspension = trackerRef.current.suspend();
    if (shouldPause) {
      setReplay((state) => state ? pauseReplay(state) : state);
      setPauseReason("operation");
    }
    return suspension;
  }, [replayRef, setReplay]);

  const restore = useCallback((suspension: ReplaySuspension | null | undefined) => {
    if (!suspension || !trackerRef.current.release(suspension)) return false;
    const state = replayRef.current;
    if (!state || state.status !== "paused") return false;
    setPauseReason(null);
    setReplay(playReplay(state));
    return true;
  }, [replayRef, setReplay]);

  const finish = useCallback(() => {
    trackerRef.current.finish();
    setPauseReason("finished");
    setAutoPauseEvent(null);
    setReplay((state) => state ? { ...state, status: "finished" } : state);
  }, [setReplay]);

  const dismissAutoPause = useCallback(() => setAutoPauseEvent(null), []);
  const captureIntent = useCallback(() => trackerRef.current.current(), []);
  const isIntentCurrent = useCallback((intent: ReplayPlaybackIntent) => trackerRef.current.isCurrent(intent), []);
  const shouldResume = useCallback(() => trackerRef.current.canPlay(), []);

  return {
    pauseReason,
    autoPauseEvent,
    play,
    pause,
    autoPause,
    suspend,
    restore,
    finish,
    dismissAutoPause,
    captureIntent,
    isIntentCurrent,
    shouldResume,
  };
}
