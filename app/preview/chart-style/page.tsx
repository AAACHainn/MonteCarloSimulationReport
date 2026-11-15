import { notFound } from "next/navigation";
import { ChartStylePreview } from "@/components/market-replay/chart-style-preview";

export default function ChartStylePreviewPage() {
  if (process.env.USER_GROWTH_PREVIEW !== "1") notFound();
  return <ChartStylePreview />;
}
