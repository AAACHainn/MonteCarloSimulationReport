import { execFileSync } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path"), { tmpdir } = await import("node:os");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), `profile-avatar-${randomUUID()}.db`)}` }, { allowCreate: true }) };
});
import { prisma } from "@/lib/db";
import * as profiles from "./service";
import { SqliteCommitUncertainError } from "@/lib/sqlite-write";
import { POST, GET } from "@/app/api/users/route";
import { PATCH } from "@/app/api/users/[userId]/route";
import { GET as readImage } from "@/app/api/user-avatars/[fileName]/route";

const url = "http://192.168.1.2/api/users";
const context = (userId: string) => ({ params: Promise.resolve({ userId }) });
const json = (body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let png: Buffer, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "avatar-storage-")); vi.stubEnv("USER_AVATAR_DIR", directory);
  const file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  png = await sharp({ create: { width: 160, height: 80, channels: 3, background: "cyan" } }).withMetadata().png().toBuffer();
}, 30000);
afterAll(async () => { await prisma.$disconnect(); vi.unstubAllEnvs(); });
function upload(nickname: string, bytes = png, type = "image/png") {
  const body = new FormData(); body.set("nickname", nickname); body.set("image", new File([new Uint8Array(bytes)], "untrusted-name.png", { type }));
  body.set("zoom", "1.5"); body.set("x", "100"); body.set("y", "0");
  return new Request(url, { method: "POST", body });
}
describe("atomic profile avatars through real SQLite/API", () => {
  it("saves presets and preserves them on nickname-only updates", async () => {
    const created = await POST(json({ nickname: "预制测试", avatar: { preset: 7 } })); expect(created.status).toBe(201);
    const user = (await created.json()).user; expect(user.avatar.preset).toBe(7);
    const edited = await PATCH(json({ nickname: "预制改名" }), context(user.id)); expect(edited.status).toBe(200); expect((await edited.json()).user.avatar.preset).toBe(7);
    expect((await POST(json({ nickname: "错误URL", avatar: { src: "https://example.org/a" } }))).status).toBe(400);
    expect((await POST(json({ nickname: "错误预制", avatar: { preset: 8 } }))).status).toBe(400);
  });
  it("uploads and serves re-encoded local WebP over ordinary HTTP", async () => {
    const response = await POST(upload("上传测试")); expect(response.status).toBe(201);
    const user = (await response.json()).user; expect(user.avatar.src).toMatch(/^\/api\/user-avatars\//);
    const image = await readImage(new Request(url), { params: Promise.resolve({ fileName: user.avatar.src.split("/").at(-1) }) });
    expect(image.status).toBe(200); expect(image.headers.get("content-type")).toBe("image/webp");
    const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata(); expect(metadata).toMatchObject({ width: 512, height: 512 }); expect(metadata.exif).toBeUndefined();
    expect((await GET()).status).toBe(200);
    const unchanged = await PATCH(json({ nickname: "上传改名" }), context(user.id)); expect((await unchanged.json()).user.avatar.src).toBe(user.avatar.src);
    const replaced = await PATCH(json({ nickname: "上传改名", avatar: { preset: 2 } }), context(user.id)); expect((await replaced.json()).user.avatar.preset).toBe(2);
  });
  it("keeps old profile and discards prepared bytes when the database rejects nickname", async () => {
    const a = (await (await POST(json({ nickname: "占用昵称" }))).json()).user;
    const b = (await (await POST(json({ nickname: "保持旧资料", avatar: { preset: 3 } }))).json()).user;
    const before = (await readdir(directory)).length;
    expect((await PATCH(upload(a.nickname), context(b.id))).status).toBe(409);
    expect((await readdir(directory)).length).toBe(before);
    expect(await prisma.userProfile.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ nickname: "保持旧资料", avatar: "PRESET:3" });
    expect((await PATCH(upload("不存在"), context("missing"))).status).toBe(404);
    expect((await readdir(directory)).length).toBe(before);
  });
  it.each([false, true])("retains the referenced image after an uncertain commit (editing=%s)", async editing => {
    const existing = editing ? (await (await POST(upload("不确定提交前"))).json()).user : null;
    const nickname = editing ? "不确定提交改名" : "不确定提交创建";
    const save = profiles.saveProfile;
    const spy = vi.spyOn(profiles, "saveProfile").mockImplementationOnce(async (...args) => {
      await save(...args); // The real isolated SQLite transaction has committed.
      throw new SqliteCommitUncertainError(new Error("commit acknowledgement unavailable"));
    });
    let response: Response;
    try { response = existing ? await PATCH(upload(nickname), context(existing.id)) : await POST(upload(nickname)); }
    finally { spy.mockRestore(); }
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DATABASE_COMMIT_UNCERTAIN");
    const persisted = await prisma.userProfile.findUniqueOrThrow({ where: { nickname } });
    const fileName = persisted.avatar.slice("UPLOAD:".length);
    expect(await readdir(directory)).toContain(fileName);
    expect((await readImage(new Request(url), { params: Promise.resolve({ fileName }) })).status).toBe(200);
    if (existing) expect((await readImage(new Request(url), { params: Promise.resolve({ fileName: existing.avatar.src.split("/").at(-1) }) })).status).toBe(200);
  });
  it("rejects forged payloads, path traversal and oversized streaming bodies", async () => {
    expect((await POST(upload("伪造", png, "image/jpeg"))).status).toBe(400);
    expect((await readImage(new Request(url), { params: Promise.resolve({ fileName: "../dev.db" }) })).status).toBe(404);
    expect((await POST(json({ nickname: "越界", totalXp: 100 }))).status).toBe(400);
    expect((await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: " ".repeat(9000) }))).status).toBe(413);
    expect(await prisma.userProfile.findFirst({ where: { nickname: "伪造" } })).toBeNull();
  });
});
