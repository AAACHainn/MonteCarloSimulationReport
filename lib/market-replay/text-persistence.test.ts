import { expect, it, vi } from "vitest";
import { deleteTextDrawing } from "./text-persistence";

it.each([200, 204, 404])("accepts successful or already completed text deletion (%s)", async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
  await expect(deleteTextDrawing(fetcher, "dataset", "text id")).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledWith("/api/market-datasets/dataset/drawings/text%20id", { method: "DELETE" });
});
it("retains real deletion failures for retry", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  await expect(deleteTextDrawing(fetcher, "dataset", "text")).rejects.toThrow();
});
