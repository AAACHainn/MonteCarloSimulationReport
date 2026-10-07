import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { replayReviewTemplate: mocks } }));
import { GET, POST } from "./route";
import { copy } from "@/lib/i18n";

const template = { id: "template-1", name: "交易复盘", content: "入场依据：\n执行情况：\n改进：" };
function request(body: unknown) {
  return new Request("http://localhost/api/replay-review-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.findMany.mockResolvedValue([template]); mocks.create.mockResolvedValue(template); });
describe("shared replay review templates", () => {
  it("lists templates for all datasets and sessions", async () => {
    const response = await GET();
    expect(await response.json()).toEqual([template]);
    expect(mocks.findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" }, select: { id: true, name: true, content: true } });
  });
  it("saves an exact multiline draft with a normalized name", async () => {
    const response = await POST(request({ name: "  Ｒeview  ", content: template.content }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ data: { name: "Review", normalizedName: "review", content: template.content }, select: { id: true, name: true, content: true } });
  });
  it.each([{ name: " ", content: "复盘" }, { name: "模板", content: " \n " }, { name: "长".repeat(51), content: "复盘" }, { name: "模板", content: "字".repeat(301) }])("rejects invalid names and contents without writing to the database", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("counts Unicode code points consistently with the review editor", async () => {
    expect((await POST(request({ name: "模板", content: "😀".repeat(300) }))).status).toBe(201);
    expect((await POST(request({ name: "模板", content: "😀".repeat(301) }))).status).toBe(400);
  });
  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/replay-review-templates", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps an existing template when the name collides", async () => {
    mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique name", { code: "P2002", clientVersion: "6" }));
    const response = await POST(request(template));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: copy.paperTrading.reviewTemplateNameExists });
  });
  it("returns a recoverable message when persistence fails", async () => {
    mocks.create.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request(template));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: copy.paperTrading.reviewTemplateSaveFailed });
  });
});
