import { copy } from "@/lib/i18n";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { ReplayRequestError } from "./server-request";
import type { ReplayServerResponse, ReplayServerResult } from "./server-sync-types";

/** Reuse history only from the exact account/version that authorized this advance. */
export function resolveReplayServerResponse<T extends ReplayServerResponse>(
  response: T, previous: PaperSessionSnapshot | null, expectedVersion: number | null,
): T & ReplayServerResult {
  const next = response.snapshot;
  if (!next) return { ...response, snapshot: null };
  const omitted = next.recentOrders === undefined || next.recentFills === undefined || next.recentTrades === undefined;
  if (omitted && (!previous || previous.session.id !== next.session.id
    || previous.session.datasetId !== next.session.datasetId || previous.session.version !== expectedVersion
    || previous.session.lastProcessedSequence !== response.fromSequence)) {
    throw new ReplayRequestError(copy.marketReplay.advanceConflict, 409, "STATE_CONFLICT");
  }
  return { ...response, snapshot: { ...next,
    recentOrders: next.recentOrders ?? previous!.recentOrders,
    recentFills: next.recentFills ?? previous!.recentFills,
    recentTrades: next.recentTrades ?? previous!.recentTrades,
  } };
}
