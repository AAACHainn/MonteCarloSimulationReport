import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { StatusToast } from "./status-toast";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("status toast presentation", () => {
  it("shares the success surface while allowing an accessible link", () => {
    expect(StatusToast({ message: null })).toBeNull();
    const growth = StatusToast({ message: "境界提升 +10" })!;
    const achievement = StatusToast({ message: "解锁成就", action: { href: "/users/user/achievements", label: "查看全部" } })!;
    expect(growth.props.className).toBe(achievement.props.className);
    expect(growth.props.className).toContain("pointer-events-none");
    expect(renderToStaticMarkup(growth)).toContain('role="status" aria-live="polite" aria-atomic="true"');
    const markup = renderToStaticMarkup(achievement);
    expect(markup).toContain('href="/users/user/achievements"');
    expect(markup).toContain("pointer-events-auto");
    expect(markup).toContain("focus-visible:ring-2");
  });

  it("fades within five seconds and removes animation for reduced-motion users", () => {
    const css = readFileSync(new URL("./status-toast.module.css", import.meta.url), "utf8");
    expect(StatusToast({ message: "解锁成就" })?.props.style.animationDuration).toBe("5000ms");
    expect(css).toMatch(/\.toast\s*\{\s*animation:\s*status-toast/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.toast\s*\{\s*animation:\s*none/);
  });
});
