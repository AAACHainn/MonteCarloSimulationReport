import { HistoryVersionConflict } from "./history-version";

export class ReplayRequestError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
function abortError() { return new DOMException("Replay request cancelled", "AbortError"); }
export function waitForReplayRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Retry identical commands until acknowledged or the page closes. Pausing
 * playback still allows an already submitted command to be acknowledged. */
export async function requestReplayAdvance<T>(options: {
  fetch: typeof fetch; url: string; body: string; signal: AbortSignal;
  onRetry: () => void; wait?: typeof waitForReplayRetry; timeoutMs?: number;
}) {
  const { signal } = options;
  let attempt = 0;
  for (;;) {
    if (signal.aborted) throw abortError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, options.timeoutMs ?? 15_000);
    try {
      const response = await options.fetch(options.url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: options.body, signal: controller.signal });
      const data = await response.json().catch(error => {
        if (response.ok) throw error;
        return null;
      });
      if (signal.aborted) throw abortError();
      if (!response.ok) throw new ReplayRequestError(data?.error ?? response.statusText, response.status, data?.code);
      return data as T;
    } catch (error) {
      if (signal.aborted) throw abortError();
      const retryable = !(error instanceof ReplayRequestError) || error.status >= 500
        || [408, 425, 429].includes(error.status)
        || (error.status === 409 && error.code === "SESSION_CONFLICT" && attempt < 2);
      if (!retryable) throw error;
      options.onRetry();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
    await (options.wait ?? waitForReplayRetry)(Math.min(3_000, 250 * 2 ** Math.min(attempt++, 4)), signal);
  }
}
export function assertForwardReplayResult(
  current: { currentSequence: number; generation: number },
  result: { currentSequence: number; generation: number },
) {
  if (result.generation !== current.generation || result.currentSequence <= current.currentSequence) {
    throw new ReplayRequestError("Invalid replay progress", 409, "STATE_CONFLICT");
  }
}

export async function retryReplayOperation<T>(operation: () => Promise<T>, options: {
  signal: AbortSignal; onRetry: () => void; wait?: typeof waitForReplayRetry;
}) {
  let attempt = 0;
  for (;;) {
    if (options.signal.aborted) throw abortError();
    try {
      const value = await operation();
      if (options.signal.aborted) throw abortError();
      return value;
    } catch (error) {
      if (options.signal.aborted) throw abortError();
      if (error instanceof HistoryVersionConflict || (error instanceof ReplayRequestError && error.status < 500)) throw error;
      options.onRetry();
      await (options.wait ?? waitForReplayRetry)(Math.min(3_000, 250 * 2 ** Math.min(attempt++, 4)), options.signal);
    }
  }
}
