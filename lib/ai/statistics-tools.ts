import { z } from "zod";
import { hashValue } from "./context";
import { overallStatistics, groupedStatistics } from "./statistics-v1";
import { decodeCursor, encodeCursor, resourceRef, sourceReceipt, toolFailure, toolSuccess, type ToolScope } from "./tools";
export const statisticsArguments = z.object({ view: z.enum(["overall", "setup_direction"]), cursor: z.string().max(512).nullable(), limit: z.number().int().min(1).max(50).nullable() }).strict().refine((a) => a.view !== "overall" || (a.cursor === null && a.limit === null));
export function executeStatisticsTool(scope: ToolScope, raw: unknown) {
  const parsed = statisticsArguments.safeParse(raw);
  if (!parsed.success) return toolFailure(scope, "INVALID_ARGUMENTS");
  if (scope.context.selectedEntryId) return toolFailure(scope, "OUT_OF_SCOPE");
  const a = parsed.data;
  if (a.view === "overall") {
    const data = overallStatistics(scope.context.statisticInput, scope.context.entries);
    if (!data) return toolFailure(scope, "STATISTICS_UNAVAILABLE");
    const inputHash = hashValue(scope.context.statisticInput);
    return toolSuccess(scope, { ...data, inputHash }, [sourceReceipt(scope, "statistics:overall", "STATISTICS", ["overall", "specVersion:1", "inputHash:" + inputHash], data)], { ...data.coverage, complete: true });
  }
  const all = groupedStatistics(scope.context.entries);
  if (!all) return toolFailure(scope, "STATISTICS_UNAVAILABLE");
  const groups = all.map(({ key, setupOptionId, memberKeys, ...group }) => {
    const setupRef = setupOptionId ? resourceRef(scope, "setup", setupOptionId) : null;
    return { ...group, groupRef: resourceRef(scope, "group", key), setupRef, membershipHash: hashValue(memberKeys), selection: { setup: setupRef ? { matchBy: "REF", value: setupRef } : { matchBy: "MISSING", value: null }, direction: group.direction } };
  }).sort((a, b) => (a.setupRef ?? "").localeCompare(b.setupRef ?? "") || a.direction.localeCompare(b.direction));
  const binding = ["get_session_statistics", "setup_direction"], offset = decodeCursor(scope, binding, a.cursor);
  if (offset === null || offset > groups.length) return toolFailure(scope, "INVALID_CURSOR");
  let count = Math.min(a.limit ?? 20, groups.length - offset);
  while (true) {
    const page = groups.slice(offset, offset + count), complete = offset + count === groups.length;
    const data = { view: a.view, unit: "FIFO_ROW_PRICE_POINTS_BEFORE_FEES", groups: page, totalGroups: groups.length, returnedGroups: page.length, complete,
      sort: "setupRef,direction ASC", limitations: ["NET_SETUP_STATS_UNAVAILABLE", "EXPLORATORY_GROUPS_NOT_PROVEN_ADVANTAGE"] };
    const sources = page.map((g) => sourceReceipt(scope, g.groupRef, "STATISTICS_GROUP", ["setup_direction", "specVersion:1", "membershipHash:" + g.membershipHash], g));
    sources.push(sourceReceipt(scope, "statistics:setup_direction:page", "STATISTICS_GROUP_PAGE", ["totalGroups", "returnedGroups", "complete"], { totalGroups: groups.length, returnedGroups: page.length, complete, offset }));
    const result = toolSuccess(scope, data, sources,
      { unit: data.unit, totalGroups: groups.length, returnedGroups: page.length, complete }, complete ? null : encodeCursor(scope, binding, offset + count));
    if (Buffer.byteLength(JSON.stringify(result)) <= 32768) return result;
    if (--count < 1) return toolFailure(scope, "RESULT_TOO_LARGE");
  }
}
