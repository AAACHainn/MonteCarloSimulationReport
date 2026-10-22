import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { assetDataUrl } from "./assets";
import { hashValue } from "./context";
import { displayImagesArguments, displayedImageSchema, displayedImagesFromCalls, MAX_DISPLAYED_IMAGES, type DisplayedImage } from "./display-images-contract";
import { envelopeSchema, toolFailure, toolSuccess, TOOL_VERSION, type ToolScope, type Receipt } from "./tools";

type SavedCall = { runId: string; name: string; status: string; contractVersion: string; result: string };

export async function loadDisplayedImages(runIds: string[]) {
  const calls = await prisma.aiToolCall.findMany({ where: { runId: { in: runIds }, name: "display_images", status: "COMPLETED", contractVersion: TOOL_VERSION },
    orderBy: [{ stepNo: "asc" }, { toolIndex: "asc" }], select: { runId: true, name: true, status: true, result: true } });
  return new Map(runIds.map((id) => [id, displayedImagesFromCalls(calls.filter((call) => call.runId === id))]));
}

export async function retainInterruptedImageReply(runId: string) {
  await sqliteWriteTransaction(prisma, async (tx) => {
    const run = await tx.aiRun.findUnique({ where: { id: runId } });
    if (!run || !["FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status)) return;
    // A cleared/deleted conversation must never be recreated by a late worker.
    if (!await tx.aiMessage.findFirst({ where: { runId, conversationId: run.conversationId, role: "user" } })
      || await tx.aiMessage.findFirst({ where: { runId, role: "assistant" } })) return;
    const calls = await tx.aiToolCall.findMany({ where: { runId, name: "display_images", status: "COMPLETED", contractVersion: TOOL_VERSION }, orderBy: [{ stepNo: "asc" }, { toolIndex: "asc" }] });
    if (!displayedImagesFromCalls(calls).length) return;
    await tx.aiMessage.upsert({ where: { id: `image-reply-${runId}` }, update: {}, create: { id: `image-reply-${runId}`, runId, conversationId: run.conversationId,
      role: "assistant", status: run.status, content: copy.ai.unfinishedAnswer, contextId: run.contextId } });
  });
}

export async function executeDisplayImages(scope: ToolScope, contextId: string, raw: unknown, calls: SavedCall[], signal: AbortSignal) {
  const parsed = displayImagesArguments.safeParse(raw);
  if (!parsed.success) return toolFailure(scope, "INVALID_ARGUMENTS");
  const completed = calls.filter((call) => call.runId === scope.id && call.status === "COMPLETED" && call.contractVersion === TOOL_VERSION);
  const existing = displayedImagesFromCalls(completed);
  const requested = [...new Map(parsed.data.images.map((image) => [image.assetRef, image])).values()];
  if (new Set([...existing.map((image) => image.assetId), ...requested.map((image) => image.assetRef)]).size > MAX_DISPLAYED_IMAGES) return toolFailure(scope, "IMAGE_DISPLAY_LIMIT");
  const images: DisplayedImage[] = [], receipts: Receipt[] = [];
  for (const request of requested) {
    signal.throwIfAborted();
    let matched = false;
    for (const call of completed.filter((call) => call.name === "get_chart_images")) {
      const result = envelopeSchema.safeParse(JSON.parse(call.result));
      if (!result.success || !result.data.ok || result.data.scopeId !== scope.id) continue;
      const receipt = result.data.sources.find((r) => r.sourceRef === request.sourceRef && r.evidenceKind === "CHART_IMAGE" && r.imageAttached);
      if (!receipt || !Array.isArray(result.data.data.charts)) continue;
      for (const chart of result.data.data.charts) {
        if (chart.imageStatus !== "READY" || chart.image?.assetRef !== request.assetRef || chart.variantRef !== receipt.variantRef) continue;
        const asset = await prisma.aiAsset.findUnique({ where: { id: request.assetRef } });
        if (!asset || asset.contextId !== contextId || asset.chartHash !== chart.windowHash || !asset.contentHash || asset.contentHash !== chart.image.contentHash
          || hashValue({ chartHash: asset.chartHash, assetId: asset.id, contentHash: asset.contentHash }) !== receipt.contentHash) return toolFailure(scope, "IMAGE_UNAVAILABLE");
        const image = displayedImageSchema.safeParse({ assetId: asset.id, sourceRef: receipt.sourceRef, contentHash: asset.contentHash,
          windowHash: chart.windowHash, variantRef: chart.variantRef, caption: chart.caption, symbol: chart.symbol, timeframe: chart.timeframe,
          displaySession: chart.displaySession, timezone: chart.timezone, actualTimeRange: chart.actualTimeRange, asOfTime: chart.asOfTime,
          cutoffSequence: chart.cutoffSequence, origin: chart.image.origin, mime: asset.mime });
        if (!image.success) return toolFailure(scope, "IMAGE_UNAVAILABLE");
        try { await assetDataUrl(asset.id, signal); } catch { signal.throwIfAborted(); return toolFailure(scope, "IMAGE_UNAVAILABLE"); }
        images.push(image.data); receipts.push(receipt); matched = true; break;
      }
      if (matched) break;
    }
    if (!matched) return toolFailure(scope, "NOT_FOUND_IN_SCOPE");
  }
  signal.throwIfAborted();
  return toolSuccess(scope, { images, delivery: "ATTACHED_TO_REPLY", note: "图片已关联本条回复，客户端负责加载显示；此回执不证明用户已查看。" }, receipts, { complete: true, displayedImages: images.length });
}
