// Route business-rule unit tests isolate the session boundary. The real boundary
// (required identity, version ownership, mode and archive restrictions) is covered
// separately by the SQLite session integration tests; never use this in app code.
export const replayRouteBusinessScope = {
  withReplaySessionRoute: (handler: unknown) => handler,
  accountWhere: (datasetId: string) => ({ datasetId }),
  progressWhere: (datasetId: string) => ({ datasetId }),
  drawingScopeWhere: () => ({}),
  entryProjectionWhere: () => ({}),
  journalScopeWhere: () => ({}),
  assertReplayWritable: async () => undefined,
  assertReplayDrawingWritable: async () => undefined,
  markReplayMutation: async () => undefined,
  getReplayScope: () => undefined,
  storageId: (id: string) => id,
};
