import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  startWorker: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { marketDatasetImport: {
    findUnique: mocks.findUnique,
    findMany: mocks.findMany,
    updateMany: mocks.updateMany,
  } },
}));
vi.mock("@/lib/market-replay/import-worker", () => ({ startMarketImportWorker: mocks.startWorker }));

import { GET as listImports } from "./route";
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
