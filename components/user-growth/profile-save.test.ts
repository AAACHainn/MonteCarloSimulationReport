import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarValue, UserIdentity } from "@/lib/user-growth/types";
import { writeProfile } from "./profile-save";

afterEach(() => vi.unstubAllGlobals());

describe("profile avatar save transport", () => {
  it("sends source image and crop as bounded multipart fields without overriding its boundary", async () => {
    const user = { id: "user", nickname: "Nick" } as UserIdentity;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user }) }); vi.stubGlobal("fetch", fetchMock);
    const image = new File([new Uint8Array([1, 2, 3])], "picked.png", { type: "image/png" });
    const avatar: AvatarValue = { preset: -1, src: "data:image/png;base64,abc", zoom: 2.25, x: 80, y: 10 };
    await expect(writeProfile("Nick", avatar, image, "user/id")).resolves.toBe(user);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/users/user%2Fid"); expect(init.method).toBe("PATCH"); expect(init.headers).toEqual({});
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get("nickname")).toBe("Nick"); expect(body.get("image")).toBeInstanceOf(File);
    expect((body.get("image") as File).name).toBe("picked.png");
    expect(body.get("zoom")).toBe("2.25"); expect(body.get("x")).toBe("80"); expect(body.get("y")).toBe("10");
  });
  it("sends preset JSON and omits a data URL when retaining a saved upload", async () => {
    const user = { id: "user", nickname: "Nick" } as UserIdentity, fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user }) }); vi.stubGlobal("fetch", fetchMock);
    await writeProfile("Nick", { preset: 7, zoom: 1, x: 50, y: 50 });
    let [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ "Content-Type": "application/json" }); expect(JSON.parse(init.body as string)).toEqual({ nickname: "Nick", avatar: { preset: 7 } });
    await writeProfile("Nick", { preset: -1, src: "/api/user-avatars/abc.webp", zoom: 1.5, x: 40, y: 60 }, undefined, "user");
    [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ nickname: "Nick" });
  });
  it("surfaces server save errors without pretending the profile changed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "昵称已被使用" }) }));
    await expect(writeProfile("Nick", { preset: 0, zoom: 1, x: 50, y: 50 })).rejects.toThrow("昵称已被使用");
  });
});
