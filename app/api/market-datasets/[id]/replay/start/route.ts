import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { datasetSourceInterval } from "@/lib/market-replay/dataset";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { replayStartSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = replayStartSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const dataset = await prisma.marketDataset.findUnique({ where: { id } });
  if (!dataset || dataset.status !== "READY") return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const sourceSeconds = datasetSourceInterval(dataset);
  if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
    return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
  }
  const first = await prisma.marketBar.findFirst({
    where: { datasetId: id, timestamp: { gte: new Date(parsed.data.timestamp) } },
    orderBy: { sequence: "asc" }, select: { sequence: true },
  });
  if (!first) return NextResponse.json({ error: copy.marketReplay.invalidStart }, { status: 400 });
  const currentSequence = first.sequence - 1;
  const progress = await prisma.replayProgress.upsert({
    where: { datasetId: id },
    create: {
      datasetId: id, startSequence: first.sequence, currentSequence,
      intervalMs: 1_000, playbackRate: parsed.data.playbackRate,
      displayIntervalSeconds: parsed.data.displayIntervalSeconds,
    },
    update: {
      startSequence: first.sequence, currentSequence,
      playbackRate: parsed.data.playbackRate, displayIntervalSeconds: parsed.data.displayIntervalSeconds,
    },
  });
  return NextResponse.json({
    startSequence: progress.startSequence, currentSequence: progress.currentSequence,
    playbackRate: progress.playbackRate, displayIntervalSeconds: progress.displayIntervalSeconds,
  });
}
