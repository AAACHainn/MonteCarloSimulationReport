import type { TextDrawing } from "./chart-drawings";
import type { TextDraft } from "./text-autosave";
import { copy } from "@/lib/i18n";

export async function persistTextDrawing(fetcher: typeof fetch, datasetId: string, id: string | null, draft: TextDraft, clientId: string): Promise<TextDrawing> {
  const response = await fetcher(`/api/market-datasets/${datasetId}/drawings${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(id ? draft : { type: "TEXT", ...draft, clientId }),
  });
  const data = await response.json() as { drawing?: TextDrawing; error?: string };
  if (!response.ok || data.drawing?.type !== "TEXT") throw new Error(data.error || copy.marketReplay.textAutosaveError);
  return data.drawing;
}
