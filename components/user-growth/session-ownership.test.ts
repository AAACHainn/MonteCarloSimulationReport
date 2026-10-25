import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { previewUsers } from "@/lib/user-growth/preview-data";
import { SessionOwnership } from "./session-ownership";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

it("says no user has been created instead of exposing a demo owner when the list is empty", () => {
  const html = renderToStaticMarkup(createElement(SessionOwnership, { hasUsers: false, owner: previewUsers[1], eligibility: copy.userGrowth.growthSession }));
  expect(html).toContain(copy.userGrowth.noCreatedUser);
  expect(html).not.toContain(previewUsers[1].nickname);
  expect(html).not.toContain(copy.userGrowth.growthSession);
});
it("retains unowned for existing users and the session's fixed owner for an owned session", () => {
  const unowned = renderToStaticMarkup(createElement(SessionOwnership, { hasUsers: true }));
  const owned = renderToStaticMarkup(createElement(SessionOwnership, { hasUsers: true, owner: previewUsers[1] }));
  expect(unowned).toContain(copy.userGrowth.unowned);
  expect(unowned).not.toContain(copy.userGrowth.noCreatedUser);
  expect(owned).toContain(copy.userGrowth.ownerHint(previewUsers[1].nickname));
});
