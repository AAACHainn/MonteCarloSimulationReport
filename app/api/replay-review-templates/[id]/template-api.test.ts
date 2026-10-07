import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { replayReviewTemplate: mocks } }));
import { DELETE, PATCH } from "./route";
import { copy } from "@/lib/i18n";
const context = { params: Promise.resolve({ id: "template-1" }) };
const template = { id: "template-1", name: "New", content: "入场依据：\n执行情况：" };
function request(body: unknown) { return new Request("http://localhost/api/replay-review-templates/template-1", { method: "PATCH", body: JSON.stringify(body) }); }
function databaseError(code: string) { return new Prisma.PrismaClientKnownRequestError("Database error", { code, clientVersion: "6" }); }
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue(template); mocks.delete.mockResolvedValue(template); });

describe("review template rename", () => {
  it("normalizes only the selected template name without writing its content", async () => {
    const response = await PATCH(request({ name: " Ｎew " }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(template);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "template-1" }, data: { name: "New", normalizedName: "new" }, select: { id: true, name: true, content: true } });
  });
  it.each([{ name: " " }, { name: "长".repeat(51) }, { name: "New", content: "replacement" }])("rejects invalid names and attempts to replace template contents", async (body) => {
    expect((await PATCH(request(body), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await PATCH(new Request("http://localhost/api/template", { method: "PATCH", body: "{" }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([["P2002", 409, copy.paperTrading.reviewTemplateNameExists], ["P2025", 404, copy.paperTrading.reviewTemplateNotFound]])("reports duplicate or deleted templates", async (code, status, error) => {
    mocks.update.mockRejectedValue(databaseError(String(code)));
    const response = await PATCH(request({ name: "New" }), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
  it("returns a recoverable error on a failed rename", async () => {
    mocks.update.mockRejectedValue(new Error("Offline"));
    const response = await PATCH(request({ name: "New" }), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: copy.paperTrading.reviewTemplateRenameFailed });
  });
});

describe("review template delete", () => {
  it("deletes only the requested template", async () => {
    const response = await DELETE(new Request("http://localhost/api/template", { method: "DELETE" }), context);
    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: "template-1" } });
    expect(await response.json()).toEqual({ ok: true });
  });
  it("reports an already deleted template", async () => {
    mocks.delete.mockRejectedValue(databaseError("P2025"));
    expect((await DELETE(new Request("http://localhost/api/template", { method: "DELETE" }), context)).status).toBe(404);
  });
  it("returns a recoverable error when deletion fails", async () => {
    mocks.delete.mockRejectedValue(new Error("Offline"));
    const response = await DELETE(new Request("http://localhost/api/template", { method: "DELETE" }), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: copy.paperTrading.reviewTemplateDeleteFailed });
  });
});
