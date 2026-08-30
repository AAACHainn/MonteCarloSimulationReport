import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { marketDatasetSchema } from "@/lib/validations";
import { serializeImportJob } from "@/lib/market-replay/import-jobs";

export async function GET() {
  await prisma.marketDatasetImport.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: "INTERRUPTED" },
  }).catch(() => undefined);
  const jobs = await prisma.marketDatasetImport.findMany({
    where: { status: { in: ["CREATED", "UPLOADED", "PROCESSING", "FAILED", "INTERRUPTED"] } },
    orderBy: { createdAt: "desc" }, take: 10,
  });
  return NextResponse.json(jobs.map(serializeImportJob));
}

export async function POST(request: Request) {
  const input = await request.json();
  const metadata = marketDatasetSchema.safeParse(input);
  if (!metadata.success || typeof input.fileName !== "string" || !/\.csv(?:\.gz)?$/i.test(input.fileName)) {
    return NextResponse.json({ error: metadata.success ? copy.marketReplay.validation.csvRequired : metadata.error.issues[0]?.message }, { status: 400 });
  }
  const job = await prisma.marketDatasetImport.create({
    data: { fileName: input.fileName, metadata: JSON.stringify(metadata.data) },
  });
  return NextResponse.json(serializeImportJob(job), { status: 201 });
}
