import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void>, focusSearch: vi.fn(), focusSearchButton: vi.fn() }));

vi.mock("react", () => {
  const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => {
    const next = { ...(props ?? {}) } as Record<string, unknown>;
    if (children.length) next.children = children.length === 1 ? children[0] : children;
    const ref = next.ref as { current: unknown } | undefined;
    if (ref && typeof type === "string") {
      ref.current = type === "input" ? { focus: runtime.focusSearch } : { focus: runtime.focusSearchButton, closest: () => null };
    }
    return { type, props: next };
  };
  return {
    default: { createElement }, createElement,
    useEffect: (effect: () => void) => { runtime.effects.push(effect); },
    useId: () => "test-user-search",
    useRef: (initial: unknown) => {
      const index = runtime.index++;
      if (!(index in runtime.slots)) runtime.slots[index] = { current: initial };
      return runtime.slots[index];
    },
    useState: (initial: unknown) => {
      const index = runtime.index++;
      if (!(index in runtime.slots)) runtime.slots[index] = initial;
      return [runtime.slots[index], (value: unknown) => { runtime.slots[index] = typeof value === "function" ? (value as (previous: unknown) => unknown)(runtime.slots[index]) : value; }];
    },
  };
});
vi.mock("@radix-ui/react-popover", () => ({ Root: "root", Trigger: "trigger", Portal: "portal" }));
vi.mock("lucide-react", () => ({ ArrowLeft: "arrow-left", ArrowRightLeft: "switch-icon", Check: "check", Search: "search-icon", Users: "users-icon" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/input", () => ({ Input: "input" }));
vi.mock("@/components/ui/label", () => ({ Label: "label" }));
vi.mock("@/components/ui/option-popover", () => ({ OptionPopoverContent: "content" }));
vi.mock("./user-avatar", () => ({ UserAvatar: "avatar" }));

import React, { type ReactNode } from "react";
import { copy } from "@/lib/i18n";
import type { UserIdentity } from "@/lib/user-growth/types";
import { UserSelector } from "./user-selector";

const identity = (id: string): UserIdentity => ({ id, nickname: id.toUpperCase(), avatar: { preset: 0, zoom: 1, x: 50, y: 50 }, realmLabel: "凡人" });
const users = [identity("alpha"), identity("beta"), identity("gamma")];

beforeEach(() => {
  runtime.index = 0;
  runtime.slots = [];
  runtime.effects = [];
  runtime.focusSearch.mockClear();
  runtime.focusSearchButton.mockClear();
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

function render(selected?: UserIdentity, context?: ReactNode) {
  runtime.index = 0;
  const tree = UserSelector({ users, selected, compact: true, context, onSelect: vi.fn(), onCreate: vi.fn(), onProfiles: vi.fn(), onRetry: vi.fn() }) as Node;
  runtime.effects.splice(0).forEach(effect => effect());
  return tree;
}
type Node = { type: unknown; props: Record<string, unknown> } | string | number | null | undefined | Array<Node>;
function all(node: Node): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as { type: unknown; props?: Record<string, unknown> };
  if (!element.props) return [];
  const normalized = { type: element.type, props: element.props };
  return [normalized, ...all(element.props.children as Node)];
}
function text(node: Node): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const props = (node as { props?: Record<string, unknown> }).props;
  return props ? text(props.children as Node) : "";
}
function root(node: Node) { return all(node).find(element => element.type === "root") as { type: unknown; props: Record<string, unknown> & { open: boolean; onOpenChange: (value: boolean) => void } }; }
function content(node: Node) { return all(node).find(element => element.type === "content")!; }
function userChoices(node: Node) {
  return all(node).filter(element => element.type === "button" && typeof element.props["aria-pressed"] === "boolean");
}
function openUserList(selected?: UserIdentity) {
  runtime.slots = [];
  let tree = render(selected);
  root(tree).props.onOpenChange(true);
  tree = render(selected);
  const switchButton = all(tree).find(element => element.type === "button" && all(element.props.children as Node).some(child => child.type === "switch-icon"))!;
  (switchButton.props.onClick as () => void)();
  return render(selected);
}

describe("user selector menu ordering and search interaction", () => {
  it("places the selected user first and global second, or global first when selected globally", () => {
    const personalTree = render(identity("beta"));
    const trigger = all(personalTree).find(element => element.type === "button" && element.props["aria-label"] === `${copy.userGrowth.selection}：BETA`)!;
    expect(trigger.props.className).toContain("h-5 w-5");
    expect(all(trigger as Node).find(element => element.type === "avatar")?.props.size).toBe("compact");
    const personal = userChoices(openUserList(identity("beta"))).map(button => text(button.props.children as Node));
    expect(personal).toEqual(["BETA凡人", `${copy.userGrowth.all}${copy.userGrowth.global}`, "ALPHA凡人", "GAMMA凡人"]);
    const global = userChoices(openUserList()).map(button => text(button.props.children as Node));
    expect(global).toEqual([`${copy.userGrowth.all}${copy.userGrowth.global}`, "ALPHA凡人", "BETA凡人", "GAMMA凡人"]);
  });

  it("expands search from the icon, focuses it, filters the list, and handles Escape in two steps", () => {
    let tree = openUserList(identity("beta"));
    expect(root(tree).props.open).toBe(true);

    const searchButton = all(tree).find(element => element.type === "button" && element.props["aria-label"] === copy.userGrowth.search)!;
    (searchButton.props.onClick as () => void)();
    tree = render(identity("beta"));
    expect(runtime.focusSearch).toHaveBeenCalled();
    const input = all(tree).find(element => element.type === "input")!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "gamma" } });
    tree = render(identity("beta"));
    expect(userChoices(tree).map(button => text(button.props.children as Node))).toEqual([`${copy.userGrowth.all}${copy.userGrowth.global}`, "GAMMA凡人"]);

    const preventDefault = vi.fn();
    (content(tree).props.onEscapeKeyDown as (event: { preventDefault: () => void }) => void)({ preventDefault });
    tree = render(identity("beta"));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(root(tree).props.open).toBe(true);
    expect(all(tree).some(element => element.type === "input")).toBe(false);
    expect(runtime.focusSearchButton).toHaveBeenCalled();

    root(tree).props.onOpenChange(false);
    tree = render(identity("beta"));
    expect(root(tree).props.open).toBe(false);
  });

  it("focuses the list back control and restores focus to the switch option", () => {
    const tree = openUserList(identity("beta"));
    const backButton = all(tree).find(element => element.type === "button" && element.props["aria-label"] === copy.userGrowth.backToUserMenu)!;
    expect(runtime.focusSearchButton).toHaveBeenCalled();
    (backButton.props.onClick as () => void)();
    const menu = render(identity("beta"));
    expect(all(menu).some(element => element.type === "button" && all(element.props.children as Node).some(child => child.type === "switch-icon"))).toBe(true);
    expect(runtime.focusSearchButton).toHaveBeenCalledTimes(3);
  });
  it("keeps session ownership context inside the menu instead of the always-visible trigger", () => {
    const owner = "会话归属：用户甲";
    let tree = render(identity("beta"), React.createElement("p", null, owner));
    const trigger = all(tree).find(element => element.type === "trigger")!;
    expect(text(trigger as Node)).not.toContain(owner);
    expect(root(tree).props.open).toBe(false);
    root(tree).props.onOpenChange(true);
    tree = render(identity("beta"), React.createElement("p", null, owner));
    const menu = content(tree);
    expect(root(tree).props.open).toBe(true);
    expect(text(menu as Node)).toContain(owner);
  });
});
