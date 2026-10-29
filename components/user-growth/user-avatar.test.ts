import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UserAvatar } from "./user-avatar";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const avatar = { preset: -1, src: "/example.webp", zoom: 1.5, x: 35, y: 65 };

describe("realm avatar frames", () => {
  it.each([
    ["mortal", "mortal.svg"],
    ["qi", "qi-refining.svg"],
    ["foundation", "foundation.svg"],
  ] as const)("uses the %s frame without changing the portrait crop", (realm, file) => {
    const html = renderToStaticMarkup(createElement(UserAvatar, { avatar, realm }));
    expect(html).toContain(`/avatar-realms/${file}`);
    expect(html).toContain("/example.webp");
    expect(html).toContain("object-position:35% 65%");
    expect(html).toContain("scale(1.5)");
    expect(html).toContain("h-full w-full shrink-0");
    expect(html).toContain("h-[160%] w-[160%]");
    expect(html).toContain("max-w-none");
  });

  it("leaves the portrait unframed when the realm is unknown", () => {
    const html = renderToStaticMarkup(createElement(UserAvatar, { avatar, size: "crop" }));
    expect(html).not.toContain("/avatar-realms/");
    expect(html).toContain("/example.webp");
  });
});
