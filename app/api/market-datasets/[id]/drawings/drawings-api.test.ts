import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  datasetFindUnique: vi.fn(),
  drawingFindMany: vi.fn(),
  drawingCreate: vi.fn(),
  drawingFindFirst: vi.fn(),
  drawingUpdate: vi.fn(),
  drawingDelete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    marketDataset: { findUnique: mocks.datasetFindUnique },
    marketDrawing: {
      findMany: mocks.drawingFindMany,
      create: mocks.drawingCreate,
      findFirst: mocks.drawingFindFirst,
      update: mocks.drawingUpdate,
      delete: mocks.drawingDelete,
    },
  },
}));

import { GET, POST } from "@/app/api/market-datasets/[id]/drawings/route";
import { DELETE, PATCH } from "@/app/api/market-datasets/[id]/drawings/[drawingId]/route";
import { DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_TREND_LINE_STYLE } from "@/lib/market-replay/chart-drawings";

const geometry = {
  start: { timestamp: "2026-01-01T00:00:00.000Z", sourceSequence: 10, price: 100 },
  end: { timestamp: "2026-01-01T00:05:00.000Z", sourceSequence: 15, price: 101 },
};
const record = {
  id: "drawing-1",
  datasetId: "dataset-1",
  type: "TREND_LINE",
  geometry: JSON.stringify(geometry),
  style: JSON.stringify(DEFAULT_TREND_LINE_STYLE),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const collectionContext = { params: Promise.resolve({ id: "dataset-1" }) };
const itemContext = { params: Promise.resolve({ id: "dataset-1", drawingId: "drawing-1" }) };

describe("market drawing API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.datasetFindUnique.mockResolvedValue({ id: "dataset-1" });
    mocks.drawingFindMany.mockResolvedValue([record]);
    mocks.drawingCreate.mockResolvedValue(record);
    mocks.drawingFindFirst.mockResolvedValue(record);
    mocks.drawingUpdate.mockResolvedValue(record);
    mocks.drawingDelete.mockResolvedValue(record);
  });

  it("lists drawings in serialized form", async () => {
    const response = await GET(new Request("http://localhost/api/drawings"), collectionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      drawings: [{ id: "drawing-1", type: "TREND_LINE", geometry }],
    });
  });

  it("creates a validated trend line", async () => {
    const response = await POST(new Request("http://localhost/api/drawings", {
      method: "POST",
      body: JSON.stringify({ type: "TREND_LINE", geometry, style: DEFAULT_TREND_LINE_STYLE }),
    }), collectionContext);
    expect(response.status).toBe(201);
    expect(mocks.drawingCreate).toHaveBeenCalledWith({
      data: {
        datasetId: "dataset-1",
        type: "TREND_LINE",
        geometry: JSON.stringify(geometry),
        style: JSON.stringify(DEFAULT_TREND_LINE_STYLE),
      },
    });
  });

  it("creates a validated Fibonacci retracement", async () => {
    const fibonacciRecord = {
      ...record,
      type: "FIB_RETRACEMENT",
      style: JSON.stringify(DEFAULT_FIBONACCI_RETRACEMENT_STYLE),
    };
    mocks.drawingCreate.mockResolvedValueOnce(fibonacciRecord);
    const response = await POST(new Request("http://localhost/api/drawings", {
      method: "POST",
      body: JSON.stringify({ type: "FIB_RETRACEMENT", geometry, style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE }),
    }), collectionContext);
    expect(response.status).toBe(201);
    expect(mocks.drawingCreate).toHaveBeenCalledWith({
      data: {
        datasetId: "dataset-1",
        type: "FIB_RETRACEMENT",
        geometry: JSON.stringify(geometry),
        style: JSON.stringify(DEFAULT_FIBONACCI_RETRACEMENT_STYLE),
      },
    });
  });

  it("rejects malformed drawing data", async () => {
    const response = await POST(new Request("http://localhost/api/drawings", {
      method: "POST",
      body: JSON.stringify({ type: "TREND_LINE", geometry: { start: geometry.start } }),
    }), collectionContext);
    expect(response.status).toBe(400);
    expect(mocks.drawingCreate).not.toHaveBeenCalled();
  });

  it("updates geometry or style only for an owned drawing", async () => {
    const response = await PATCH(new Request("http://localhost/api/drawings/drawing-1", {
      method: "PATCH",
      body: JSON.stringify({ style: { ...DEFAULT_TREND_LINE_STYLE, opacity: 50 } }),
    }), itemContext);
    expect(response.status).toBe(200);
    expect(mocks.drawingFindFirst).toHaveBeenCalledWith({
      where: { id: "drawing-1", datasetId: "dataset-1" },
    });

    mocks.drawingFindFirst.mockResolvedValueOnce(null);
    const missing = await PATCH(new Request("http://localhost/api/drawings/drawing-1", {
      method: "PATCH",
      body: JSON.stringify({ geometry }),
    }), itemContext);
    expect(missing.status).toBe(404);
  });

  it("deletes only a drawing belonging to the dataset", async () => {
    const response = await DELETE(new Request("http://localhost/api/drawings/drawing-1", {
      method: "DELETE",
    }), itemContext);
    expect(response.status).toBe(200);
    expect(mocks.drawingDelete).toHaveBeenCalledWith({ where: { id: "drawing-1" } });
  });
});
