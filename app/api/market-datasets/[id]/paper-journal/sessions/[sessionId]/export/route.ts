import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { createReplayJournalExcel, replayJournalExcelFilename } from "@/lib/paper-trading/journal-excel";
import { serializeReplayJournalEntry } from "@/lib/paper-trading/journal";

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id, sessionId } = await context.params;
  const session = await prisma.replayJournalSession.findFirst({
    where: { id: sessionId, datasetId: id },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      entries: {
        include: {
          setupOption: { select: { name: true } },
          tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        },
        orderBy: [{ accountNo: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!session) return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });

  try {
    const entries = session.entries.map((entry) => serializeReplayJournalEntry({
      ...entry,
      journalSession: { archivedAt: session.archivedAt },
    }));
    const workbook = await createReplayJournalExcel(entries);
    const filename = replayJournalExcelFilename(session.name, session.id);
    const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
    return new NextResponse(workbook, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="replay-journal-${session.id}.xlsx"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: copy.paperTrading.journalExportFailed }, { status: 500 });
  }
}
