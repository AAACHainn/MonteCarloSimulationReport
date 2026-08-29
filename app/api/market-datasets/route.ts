import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MarketCsvValidationError, parseMarketBarsCsv } from "@/lib/market-replay/parse-market-bars";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import { MAX_MARKET_CSV_BYTES } from "@/lib/market-replay/types";
import { marketDatasetSchema } from "@/lib/validations";
import { copy } from "@/lib/i18n";

const INSERT_CHUNK_SIZE = 1_000;

export async function GET() {
  const datasets = await prisma.marketDataset.findMany({
    include: { progress: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(datasets.map(serializeMarketDataset));
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const metadata = marketDatasetSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    symbol: formData.get("symbol"),
    timeframe: formData.get("timeframe"),
    timezone: formData.get("timezone"),
  });

  if (!metadata.success) {
    return NextResponse.json({ error: metadata.error.issues[0]?.message ?? copy.marketReplay.validation.metadataInvalid }, { status: 400 });
  }
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: copy.marketReplay.validation.csvRequired }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_MARKET_CSV_BYTES) {
    return NextResponse.json({ error: copy.marketReplay.validation.fileSize }, { status: 413 });
  }

  try {
    const bars = parseMarketBarsCsv(await file.text(), metadata.data.timezone);
    const dataset = await prisma.$transaction(async (tx) => {
      const created = await tx.marketDataset.create({
        data: {
          ...metadata.data,
          description: metadata.data.description || null,
          barCount: bars.length,
          startTime: bars[0].timestamp,
          endTime: bars[bars.length - 1].timestamp,
        },
      });

      for (let index = 0; index < bars.length; index += INSERT_CHUNK_SIZE) {
        await tx.marketBar.createMany({
          data: bars.slice(index, index + INSERT_CHUNK_SIZE).map((bar) => ({ ...bar, datasetId: created.id })),
        });
      }
      return created;
    }, { timeout: 120_000 });

    return NextResponse.json({ id: dataset.id, imported: dataset.barCount }, { status: 201 });
  } catch (error) {
    if (error instanceof MarketCsvValidationError) {
      return NextResponse.json({ error: error.message, errors: error.issues, totalErrors: error.totalIssues }, { status: 400 });
    }
    console.error("Market dataset import failed", error);
    return NextResponse.json({ error: copy.marketReplay.importError }, { status: 500 });
  }
}
