import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  startWorker: vi.fn(),
  findDataset: vi.fn(),
  createJob: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { marketDataset: { findUnique: mocks.findDataset }, marketDatasetImport: {
    create: mocks.createJob,
    findUnique: mocks.findUnique,
    findMany: mocks.findMany,
    updateMany: mocks.updateMany,
  } },
}));
vi.mock("@/lib/market-replay/import-worker", () => ({ startMarketImportWorker: mocks.startWorker }));

import { GET as listImports, POST as createImport } from "./route";
import { POST as startImport } from "./[jobId]/process/route";

const job = {
  id: "job-1", storedPath: "D:/tmp/job.csv", status: "UPLOADED", datasetId: null,
  compressedBytes: BigInt(1_000),
};
const context = { params: Promise.resolve({ jobId: "job-1" }) };

describe("market import background API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.startWorker.mockReturnValue(4321);
  });

  it("atomically queues a worker and returns 202 without waiting for import completion", async () => {
    mocks.findUnique.mockResolvedValue(job);
    const response = await startImport(new Request("http://localhost/process", { method: "POST" }), context);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true, jobId: "job-1" });
    expect(mocks.startWorker).toHaveBeenCalledWith("job-1");
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "job-1", status: { in: ["UPLOADED", "FAILED", "INTERRUPTED"] } },
      data: expect.objectContaining({ status: "QUEUED", stage: "ANALYZING" }),
    }));
  });

  it("rejects duplicate starts while a job is already processing", async () => {
    mocks.findUnique.mockResolvedValue({ ...job, status: "PROCESSING" });
    const response = await startImport(new Request("http://localhost/process", { method: "POST" }), context);
    expect(response.status).toBe(409);
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });

  it("marks stale queued and processing workers as interrupted", async () => {
    mocks.findMany.mockResolvedValue([]);
    const response = await listImports();
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["QUEUED", "PROCESSING"] } }),
      data: { status: "INTERRUPTED", workerPid: null },
    }));
  });
});

const appendTarget = { id: "target", name: "MGC", status: "READY", symbol: "MGC", timeframe: "1m", timezone: "UTC",
  sourceIntervalSeconds: 60, priceTickSize: 0.1, sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null,
  sessionCloseMinute: null, tradingWeekdays: "1,2,3,4,5,6,7" };
describe("append import API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.findDataset.mockResolvedValue(appendTarget);
    mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.startWorker.mockReturnValue(4321);
  });
  it.each([{ symbol: "ES", sourceIntervalSeconds: 60 }, { symbol: "MGC", sourceIntervalSeconds: 300 }])("rejects declared metadata mismatch before creating a job (%o)", async (fields) => {
    const response = await createImport(new Request("http://localhost/imports", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "APPEND", targetDatasetId: "target", fileName: "new.csv", ...fields }) }));
    expect(response.status).toBe(400); expect(mocks.createJob).not.toHaveBeenCalled();
  });
  it("requires explicit gap confirmation and atomically retains the validated preview", async () => {
    mocks.findUnique.mockResolvedValue({ ...job, status: "AWAITING_CONFIRMATION", datasetId: "staging", metadata: JSON.stringify({ mode: "APPEND", targetDatasetId: "target", preview: { gapCount: 2 } }) });
    const noConfirmation = await startImport(new Request("http://localhost/process", { method: "POST" }), context);
    expect(noConfirmation.status).toBe(409); expect(mocks.startWorker).not.toHaveBeenCalled();
    const yes = await startImport(new Request("http://localhost/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmGaps: true }) }), context);
    expect(yes.status).toBe(202);
    const claim = mocks.updateMany.mock.calls[0][0];
    expect(claim.where.status.in).toEqual(["AWAITING_CONFIRMATION"]);
    expect(JSON.parse(claim.data.metadata)).toMatchObject({ confirmed: true, preview: { gapCount: 2 } });
    expect(claim.data.importedBars).toBeUndefined();
  });
  it("rejects a lost confirmation claim without launching another worker", async () => {
    mocks.findUnique.mockResolvedValue({ ...job, status: "AWAITING_CONFIRMATION", metadata: "{}" });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await startImport(new Request("http://localhost/process", { method: "POST", body: JSON.stringify({ confirmGaps: true }) }), context);
    expect(response.status).toBe(409); expect(mocks.startWorker).not.toHaveBeenCalled();
  });
});
