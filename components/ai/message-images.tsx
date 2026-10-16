"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, Loader2, Maximize2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { copy, defaultLocale } from "@/lib/i18n";
import type { DisplayedImage } from "@/lib/ai/display-images-contract";

function ChartImage({ image, expanded = false, onPreview }: { image: DisplayedImage; expanded?: boolean; onPreview?: () => void }) {
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false), [attempt, setAttempt] = useState(0);
  if (failed) return <Alert role="alert" className="space-y-2 border-red-200 bg-red-50 text-red-700">
    <p>{copy.ai.replyImageFailed}</p>
    <Button type="button" variant="outline" onClick={() => { setFailed(false); setLoaded(false); setAttempt((value) => value + 1); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />{copy.ai.retryImage}</Button>
  </Alert>;
  const picture = <Image key={attempt} unoptimized loading="lazy" width={1200} height={600}
      src={`/api/ai/assets/${image.assetId}${attempt ? `?retry=${attempt}` : ""}`} alt={copy.ai.replyImageAlt(image.symbol, image.timeframe)}
      className={`h-auto w-full object-contain ${expanded ? "max-h-[65dvh]" : "max-h-72"} ${loaded ? "" : "opacity-0"}`}
      onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />;
  return <div className="relative min-h-24" aria-busy={!loaded}>
    {!loaded ? <span role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-slate-600"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{copy.ai.loadingReplyImage}</span> : null}
    {onPreview ? <Button type="button" variant="ghost" disabled={!loaded} className="h-auto w-full overflow-hidden border p-0" onClick={onPreview} aria-label={copy.ai.previewReplyImage(`${image.symbol} ${image.timeframe}`)}>{picture}</Button> : picture}
  </div>;
}

function ImageAttachment({ image }: { image: DisplayedImage }) {
  const [preview, setPreview] = useState(false);
  const title = `${image.symbol} · ${image.timeframe} · ${image.displaySession}`;
  const time = (value: string) => new Date(value).toLocaleString(defaultLocale, { timeZone: image.timezone, timeZoneName: "short" });
  const download = <Button asChild variant="outline"><a href={`/api/ai/assets/${image.assetId}?download=1`} download><Download className="h-4 w-4" aria-hidden="true" />{copy.ai.downloadReplyImage}</a></Button>;
  return <Card data-ai-image={image.assetId} className="min-w-0 overflow-hidden">
    <CardHeader className="gap-1 p-3">
      <CardTitle className="text-sm leading-5">{title}</CardTitle>
      <CardDescription className="text-xs">{copy.ai.reconstructedReplyImage}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 p-3 pt-0">
      <ChartImage image={image} onPreview={() => setPreview(true)} />
      <p className="break-words text-xs leading-5 text-slate-600">{image.caption}</p>
      <p className="break-words text-xs tabular-nums text-slate-500">{copy.ai.replyImageRange(time(image.actualTimeRange[0]), time(image.actualTimeRange[1]))}<br />{copy.ai.frozenAt(image.asOfTime)}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setPreview(true)} aria-label={copy.ai.previewReplyImage(title)}><Maximize2 className="h-4 w-4" aria-hidden="true" />{copy.ai.enlargeReplyImage}</Button>
        {download}
      </div>
      <Dialog open={preview} title={title} description={copy.ai.reconstructedReplyImage} onClose={() => setPreview(false)} layerClassName="z-[90]" className="max-w-6xl">
        <div className="space-y-4"><ChartImage image={image} expanded /><p className="text-sm leading-6 text-slate-600">{image.caption}</p><div className="flex justify-end border-t pt-4">{download}</div></div>
      </Dialog>
    </CardContent>
  </Card>;
}

export function AiMessageImages({ images }: { images: DisplayedImage[] }) {
  if (!images.length) return null;
  return <div className="grid min-w-0 grid-cols-1 gap-3" aria-label={copy.ai.replyImages}>
    {images.map((image) => <ImageAttachment key={image.assetId} image={image} />)}
  </div>;
}
