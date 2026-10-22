import { NextResponse } from "next/server";
import { copy } from "@/lib/i18n";
import { isSqliteBusy, SqliteCommitUncertainError, SqliteWriteBusyError } from "./sqlite-write";

export function sqliteErrorResponse(error: unknown) {
  if (error instanceof SqliteCommitUncertainError) return NextResponse.json({ error: copy.common.databaseUncertain, code: error.code }, { status: 409 });
  if (error instanceof SqliteWriteBusyError || isSqliteBusy(error)) {
    return NextResponse.json({ error: copy.common.databaseBusy, code: "DATABASE_BUSY" }, { status: 503, headers: { "Retry-After": "1" } });
  }
  return null;
}

/** Error presentation only. Never repeats a request or its external effects. */
export function withSqliteErrors<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args) => {
    try { return await handler(...args); }
    catch (error) { const response = sqliteErrorResponse(error); if (response) return response; throw error; }
  };
}
