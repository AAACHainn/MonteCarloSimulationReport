import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ jobs: vi.fn(), job: vi.fn(), lease: vi.fn(), recover: vi.fn(), spawn: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { marketAggregationJob: { findMany: mocks.jobs, findUnique: mocks.job }, marketDatasetUpdateLease: { findUnique: mocks.lease } } }));
vi.mock("@/lib/market-sync/lease", () => ({ aggregationOwner: (id: string, token: string) => `aggregation_${id}_${token}`, recoverAggregationJobs: mocks.recover }));
vi.mock("./aggregation-worker", () => ({ startAggregationWorker: mocks.spawn }));
import { aggregationDispatchCandidate, startAggregationRuntime } from "./aggregation-runtime";
const globals = globalThis as unknown as { aggregationRuntime?: { stop: () => void; tick: () => Promise<void> } };
beforeEach(() => {
  mocks.job.mockReset().mockResolvedValue({ status: "QUEUED", workerToken: "queue-round" });
  mocks.jobs.mockReset().mockResolvedValue([]); mocks.lease.mockReset().mockResolvedValue(null);
  mocks.recover.mockReset().mockResolvedValue(false); mocks.spawn.mockReset().mockImplementation(() => new EventEmitter());
});
afterEach(() => { globals.aggregationRuntime?.stop(); delete globals.aggregationRuntime; vi.unstubAllEnvs(); });
describe("persistent aggregation dispatcher", () => {
  it("starts independently of the market sync switch and binds spawn to the queued token", async () => {
    vi.stubEnv("VITEST", ""); vi.stubEnv("NEXT_PHASE", "phase-production-server"); vi.stubEnv("MARKET_DATA_SYNC_ENABLED", "0");
    mocks.jobs.mockImplementation(async ({ where }: { where: { status: string } }) => where.status === "QUEUED" ? [{ id: "job", datasetId: "data", workerToken: "queue-round" }] : []);
    expect(startAggregationRuntime()).toBeDefined();
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledWith("job", "queue-round"));
    await globals.aggregationRuntime!.tick();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
  it("backs off repeated child exits before claim instead of creating a spawn storm", async () => {
    vi.stubEnv("VITEST", ""); vi.stubEnv("NEXT_PHASE", "phase-production-server");
    const child = new EventEmitter(); mocks.spawn.mockReturnValue(child);
    mocks.jobs.mockImplementation(async ({ where }: { where: { status: string } }) => where.status === "QUEUED" ? [{ id: "job", datasetId: "data", workerToken: "queue-round" }] : []);
    startAggregationRuntime();
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    child.emit("exit", 1);
    await vi.waitFor(() => expect(mocks.job).toHaveBeenCalledTimes(1));
    await globals.aggregationRuntime!.tick(); await globals.aggregationRuntime!.tick();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
  it("does not spawn or write an idle heartbeat while another execution has both valid leases", async () => {
    mocks.jobs.mockResolvedValue([{ id: "running", datasetId: "data", workerToken: "worker", leaseUntil: new Date(Date.now() + 60000) }]);
    mocks.lease.mockResolvedValue({ owner: "aggregation_running_worker", expiresAt: new Date(Date.now() + 60000) });
    expect(await aggregationDispatchCandidate()).toBeNull();
    expect(mocks.recover).not.toHaveBeenCalled(); expect(mocks.jobs).toHaveBeenCalledTimes(1);
  });
  it("explicitly recovers an orphan even without queued work and leaves an idle queue read-only", async () => {
    mocks.jobs.mockResolvedValueOnce([{ id: "orphan", datasetId: "data", workerToken: "old", leaseUntil: new Date(0) }]).mockResolvedValue([]);
    expect(await aggregationDispatchCandidate()).toBeNull(); expect(mocks.recover).toHaveBeenCalledTimes(1);
    mocks.recover.mockClear();
    expect(await aggregationDispatchCandidate()).toBeNull(); expect(mocks.recover).not.toHaveBeenCalled();
  });
});
