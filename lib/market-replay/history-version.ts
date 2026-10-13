export class HistoryVersionConflict extends Error {}
export function marketVersionMatches(server: { dataVersion: number; historyVersion?: number }, request: { dataVersion: number; historyVersion?: number }) {
  return request.historyVersion === undefined ? server.dataVersion === request.dataVersion
    : server.historyVersion === request.historyVersion && request.dataVersion <= server.dataVersion;
}
