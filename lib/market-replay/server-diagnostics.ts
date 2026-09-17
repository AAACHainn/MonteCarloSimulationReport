import { replayDatabaseQueryCount } from "@/lib/db";

type DiagnosticOptions = {
  queryStart: number | null;
  startedAt: number;
  strategy?: string;
  phases?: Record<string, number>;
};

function timingToken(name: string, duration: number) {
  return `${name};dur=${Math.max(0, duration).toFixed(1)}`;
}

/** Add lightweight diagnostics without changing an endpoint's JSON contract. */
export function attachReplayDiagnostics(response: Response, options: DiagnosticOptions) {
  const timings = Object.entries(options.phases ?? {}).map(([name, duration]) => timingToken(name, duration));
  timings.push(timingToken("total", performance.now() - options.startedAt));
  response.headers.set("Server-Timing", timings.join(", "));
  if (options.strategy) response.headers.set("X-Replay-Window-Strategy", options.strategy);
  if (options.queryStart !== null) {
    response.headers.set(
      "X-Replay-Database-Queries",
      String((replayDatabaseQueryCount() ?? options.queryStart) - options.queryStart),
    );
  }
  return response;
}
